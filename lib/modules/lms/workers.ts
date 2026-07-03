// LMS lifecycle workers (invoked by the platform cron scheduler via jobs.ts):
// scheduled-assignment activation, Litmos completion polling + webhook intake,
// and the daily due-date tick (overdue transitions, cadence reminders,
// compliance recompute/auto-reassign, schedule.daily rule fan-out). All loops
// are per-row/per-org try/catch so one bad org or row can't abort a tick.

import { randomUUID } from "crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { getLitmosCreds, getUserCourseResult, type LitmosCreds } from "@/lib/platform/litmos";
import { activateLmsAssignment, completeLmsAssignment, createLmsAssignments } from "./assignments";
import { recomputeCompliance } from "./compliance";
import { getLmsSettings, sendLmsNotice } from "./notifications";
import { fireLmsEvent } from "./rules";
import {
  lmsAssignments,
  lmsComplianceProfiles,
  lmsLearners,
  lmsReminderLog,
  lmsRules,
  lmsTeamMembers,
  type LmsAssignmentRow,
} from "./schema";
import { daysUntil, parseReminderDays, reminderBucket, type LmsEvent } from "./types";

const DAY_MS = 86_400_000;

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}

function assignmentVars(row: LmsAssignmentRow): Record<string, string | number> {
  return {
    learner: row.learnerName || row.learnerEmail,
    learnerEmail: row.learnerEmail,
    course: row.courseName || row.courseLitmosId,
    courseId: row.courseLitmosId,
    dueDate: fmtDate(row.dueDate),
  };
}

function assignmentEvent(trigger: LmsEvent["trigger"], row: LmsAssignmentRow): LmsEvent {
  return {
    trigger,
    learner: { email: row.learnerEmail, name: row.learnerName, litmosUserId: row.litmosUserId },
    course: { litmosId: row.courseLitmosId, name: row.courseName },
    assignment: { id: row.id, dueDate: row.dueDate, score: row.score },
  };
}

// ─── activation ───────────────────────────────────────────────────────────────

export async function activateScheduledLms(): Promise<{ activated: number }> {
  const rows = await db
    .select()
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.status, "scheduled"), lte(lmsAssignments.scheduledFor, Date.now())))
    .limit(50);
  for (const row of rows) await activateLmsAssignment(row);
  return { activated: rows.length };
}

// ─── completions ──────────────────────────────────────────────────────────────

// Shared post-completion hook (poller + webhook): fire the rule event, then the
// completion notice. Both callees are non-throwing by contract.
async function afterCompletion(orgId: string, row: LmsAssignmentRow): Promise<void> {
  await fireLmsEvent(orgId, assignmentEvent("assignment.completed", row));
  await sendLmsNotice(
    orgId,
    "completed",
    {
      ...assignmentVars(row),
      score: row.score ?? "",
      scoreClause: row.score !== null && row.score !== undefined ? ` with score ${row.score}` : "",
    },
    { learnerEmail: row.learnerEmail },
  );
}

export async function pollLmsCompletions(): Promise<{ checked: number; completed: number }> {
  const rows = await db
    .select()
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.status, "active"), isNull(lmsAssignments.completedAt)))
    .limit(200);
  // Creds cached per org for the batch (rows are interleaved across orgs).
  const credsByOrg = new Map<string, LitmosCreds | null>();
  let checked = 0;
  let completed = 0;
  for (const row of rows) {
    try {
      if (!row.litmosUserId) continue;
      let creds = credsByOrg.get(row.orgId);
      if (creds === undefined) {
        creds = await getLitmosCreds(row.orgId);
        credsByOrg.set(row.orgId, creds);
      }
      if (!creds) continue;
      checked++;
      const result = await getUserCourseResult(creds, row.litmosUserId, row.courseLitmosId);
      if (!result?.CompletedDate) continue;
      const parsed = new Date(result.CompletedDate).getTime();
      const updated = await completeLmsAssignment(
        row.orgId,
        { courseId: row.courseLitmosId, litmosUserId: row.litmosUserId },
        { completedAt: Number.isNaN(parsed) ? Date.now() : parsed, score: result.Score ?? null },
      );
      if (!updated) continue;
      completed++;
      await afterCompletion(row.orgId, updated);
    } catch {
      // Per-row: a Litmos hiccup on one assignment must not stop the sweep.
    }
  }
  return { checked, completed };
}

// Webhook/callback intake: mark the matching open assignment completed. Returns
// whether anything matched so the route can 200/404 appropriately.
export async function lmsHandleCompletion(
  orgId: string,
  payload: { courseId?: string; userId?: string; email?: string; CompletedDate?: string; completedAt?: string; Score?: number; score?: number },
): Promise<boolean> {
  if (!payload.courseId) return false;
  const when = payload.CompletedDate || payload.completedAt;
  const parsed = when ? new Date(when).getTime() : NaN;
  const updated = await completeLmsAssignment(
    orgId,
    { courseId: payload.courseId, litmosUserId: payload.userId, email: payload.email },
    { completedAt: Number.isNaN(parsed) ? Date.now() : parsed, score: payload.Score ?? payload.score ?? null },
  );
  if (!updated) return false;
  await afterCompletion(orgId, updated);
  return true;
}

// ─── the due-date tick ────────────────────────────────────────────────────────

export async function tickLmsDueDates(): Promise<{
  orgs: number;
  overdue: number;
  reminders: number;
  complianceEvents: number;
  reassigned: number;
  dailyFired: number;
}> {
  const [assignmentOrgs, profileOrgs] = await Promise.all([
    db.selectDistinct({ orgId: lmsAssignments.orgId }).from(lmsAssignments),
    db.selectDistinct({ orgId: lmsComplianceProfiles.orgId }).from(lmsComplianceProfiles),
  ]);
  const orgIds = [...new Set([...assignmentOrgs, ...profileOrgs].map((r) => r.orgId))];
  const summary = { orgs: orgIds.length, overdue: 0, reminders: 0, complianceEvents: 0, reassigned: 0, dailyFired: 0 };
  const now = Date.now();

  for (const orgId of orgIds) {
    try {
      const settings = await getLmsSettings(orgId);
      const cadence = parseReminderDays(settings.reminderDays);

      // 1. OVERDUE: flip past-due open rows; the reminder ledger (kind
      // "overdue", bucket 0) makes the notice/event once-per-assignment even if
      // a crash re-runs the transition.
      const pastDue = await db
        .select()
        .from(lmsAssignments)
        .where(and(eq(lmsAssignments.orgId, orgId), inArray(lmsAssignments.status, ["pending", "active"]), lt(lmsAssignments.dueDate, now)));
      for (const row of pastDue) {
        await db
          .update(lmsAssignments)
          .set({ status: "overdue", updatedAt: now })
          .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, row.id)));
        summary.overdue++;
        const [logged] = await db
          .insert(lmsReminderLog)
          .values({ id: randomUUID(), orgId, assignmentId: row.id, kind: "overdue", bucket: 0, sentAt: now })
          .onConflictDoNothing()
          .returning();
        if (!logged) continue;
        const daysOverdue = Math.max(1, -daysUntil(row.dueDate!, now));
        await sendLmsNotice(orgId, "overdue", { ...assignmentVars(row), daysOverdue }, { learnerEmail: row.learnerEmail });
        await fireLmsEvent(orgId, { ...assignmentEvent("assignment.overdue", row), daysOverdue });
      }

      // 2. DUE SOON: cadence reminders for open rows still ahead of their due
      // date; each (assignment, bucket) fires once via the ledger.
      const upcoming = await db
        .select()
        .from(lmsAssignments)
        .where(
          and(eq(lmsAssignments.orgId, orgId), inArray(lmsAssignments.status, ["pending", "scheduled", "active"]), gt(lmsAssignments.dueDate, now)),
        );
      for (const row of upcoming) {
        const bucket = reminderBucket(row.dueDate!, now, cadence);
        if (bucket === null) continue;
        const [logged] = await db
          .insert(lmsReminderLog)
          .values({ id: randomUUID(), orgId, assignmentId: row.id, kind: "due_soon", bucket, sentAt: now })
          .onConflictDoNothing()
          .returning();
        if (!logged) continue;
        const daysLeft = daysUntil(row.dueDate!, now);
        await sendLmsNotice(orgId, "due_soon", { ...assignmentVars(row), daysLeft }, { learnerEmail: row.learnerEmail });
        await fireLmsEvent(orgId, { ...assignmentEvent("assignment.due_soon", row), daysLeft });
        summary.reminders++;
      }

      // 3. COMPLIANCE: recompute returns only rows that transitioned this pass,
      // so every event/notice below fires exactly once per cycle. cycleKey =
      // expiry timestamp keeps rule dedupe scoped to the current cycle.
      const profiles = await db.select().from(lmsComplianceProfiles).where(eq(lmsComplianceProfiles.orgId, orgId));
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const { transitionedExpiring, transitionedExpired } = await recomputeCompliance(orgId, now);
      for (const rec of transitionedExpiring) {
        const profile = profileById.get(rec.profileId);
        const courseId = rec.courseLitmosId ?? profile?.courseLitmosId ?? "";
        const courseName = profile?.courseName ?? profile?.name ?? null;
        const daysToExpiry = rec.expiresAt ? daysUntil(rec.expiresAt, now) : 0;
        await fireLmsEvent(orgId, {
          trigger: "compliance.expiring",
          learner: { email: rec.learnerEmail, name: rec.learnerName },
          course: { litmosId: courseId, name: courseName },
          daysToExpiry,
          cycleKey: String(rec.expiresAt),
        });
        await sendLmsNotice(
          orgId,
          "compliance_expiring",
          {
            learner: rec.learnerName || rec.learnerEmail,
            learnerEmail: rec.learnerEmail,
            course: courseName || courseId,
            courseId,
            expiresDate: fmtDate(rec.expiresAt),
            daysToExpiry,
          },
          { learnerEmail: rec.learnerEmail },
        );
        summary.complianceEvents++;
      }
      for (const rec of transitionedExpired) {
        const profile = profileById.get(rec.profileId);
        const courseId = rec.courseLitmosId ?? profile?.courseLitmosId ?? "";
        const courseName = profile?.courseName ?? profile?.name ?? null;
        const daysToExpiry = rec.expiresAt ? daysUntil(rec.expiresAt, now) : 0; // negative once lapsed
        await fireLmsEvent(orgId, {
          trigger: "compliance.expiring",
          learner: { email: rec.learnerEmail, name: rec.learnerName },
          course: { litmosId: courseId, name: courseName },
          daysToExpiry,
          cycleKey: String(rec.expiresAt),
        });
        summary.complianceEvents++;
        if (!profile?.autoReassign) continue;
        const dueDate = now + profile.warnDays * DAY_MS;
        // createLmsAssignments' open-assignment dedupe prevents doubles when a
        // reassignment from a previous cycle is still open.
        const { created } = await createLmsAssignments(orgId, [
          {
            learnerEmail: rec.learnerEmail,
            learnerName: rec.learnerName ?? undefined,
            courseLitmosId: profile.courseLitmosId,
            courseName: profile.courseName ?? undefined,
            dueDate,
            assignedBy: `compliance:${profile.id}`,
          },
        ]);
        if (created > 0) {
          summary.reassigned += created;
          await sendLmsNotice(
            orgId,
            "assignment_created",
            {
              learner: rec.learnerName || rec.learnerEmail,
              learnerEmail: rec.learnerEmail,
              course: profile.courseName || profile.courseLitmosId,
              courseId: profile.courseLitmosId,
              dueDate: fmtDate(dueDate),
              dueClause: `, due ${fmtDate(dueDate)}`,
            },
            { learnerEmail: rec.learnerEmail },
          );
        }
      }

      // 4. DAILY RULES: fan schedule.daily out to every active learner. The
      // rule-run ledger (cycleKey = UTC date) makes this once/learner/day per
      // rule, so re-running the tick is safe.
      const dailyRules = await db
        .select({ id: lmsRules.id })
        .from(lmsRules)
        .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.enabled, true), eq(lmsRules.trigger, "schedule.daily")))
        .limit(1);
      if (dailyRules.length) {
        const utcDate = new Date(now).toISOString().slice(0, 10);
        const memberships = await db
          .select({ teamLitmosId: lmsTeamMembers.teamLitmosId, learnerLitmosId: lmsTeamMembers.learnerLitmosId })
          .from(lmsTeamMembers)
          .where(eq(lmsTeamMembers.orgId, orgId));
        const teamsByLearner = new Map<string, string[]>();
        for (const m of memberships) {
          const teams = teamsByLearner.get(m.learnerLitmosId) ?? [];
          teams.push(m.teamLitmosId);
          teamsByLearner.set(m.learnerLitmosId, teams);
        }
        const learners = await db
          .select()
          .from(lmsLearners)
          .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.active, true), isNotNull(lmsLearners.email)))
          .limit(1000);
        for (const l of learners) {
          if (!l.email) continue;
          const { fired } = await fireLmsEvent(orgId, {
            trigger: "schedule.daily",
            learner: { email: l.email, name: l.fullName, litmosUserId: l.litmosId, teamIds: teamsByLearner.get(l.litmosId) ?? [] },
            cycleKey: utcDate,
          });
          summary.dailyFired += fired;
        }
      }
    } catch {
      // Per-org: one org's failure must not abort the whole tick.
    }
  }

  return summary;
}
