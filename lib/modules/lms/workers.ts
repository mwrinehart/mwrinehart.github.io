// LMS lifecycle workers (invoked by the platform cron scheduler via jobs.ts):
// scheduled-assignment activation, Litmos completion polling + webhook intake,
// and the daily due-date tick (overdue transitions, cadence reminders,
// compliance effects, schedule.daily rule fan-out). All loops are per-row/per-org
// try/catch so one bad org or row can't abort a tick.
//
// Effect discipline: notices are STATE-based and ledger-gated (lms_reminder_log —
// once per assignment/record per due-date or expiry cycle), while rule events are
// re-emitted each tick with a cycle-scoped dedupe key, so a threshold rule
// ("7+ days overdue", "expiring within 3 days") fires at the first tick its
// conditions match — once per cycle — instead of only at the transition instant.
// Driving everything off state (not recompute transitions) also means a manual
// "Recompute now" can never swallow notices or auto-reassignments.

import { randomUUID } from "crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { getLitmosCreds, getUserCourseResult, type LitmosCreds } from "@/lib/platform/litmos";
import { activateLmsAssignment, completeLmsAssignment, createLmsAssignments } from "./assignments";
import { recomputeCompliance } from "./compliance";
import { getLmsSettings, sendLmsNotice } from "./notifications";
import { fireLmsEvent } from "./rules";
import {
  lmsAssignments,
  lmsComplianceProfiles,
  lmsComplianceRecords,
  lmsLearners,
  lmsReminderLog,
  lmsRules,
  lmsTeamMembers,
  type LmsAssignmentRow,
} from "./schema";
import { daysUntil, parseReminderDays, reminderBucket, type LmsEvent, type RuleTrigger } from "./types";

const DAY_MS = 86_400_000;
// External sends (notices + auto-reassigns) per org per tick — bounds the wave
// when a new compliance profile makes a whole historical cohort lapse at once;
// the remainder processes on subsequent ticks.
const COMPLIANCE_EFFECTS_CAP = 100;
const OVERDUE_SCAN_CAP = 1000;

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}

function dueClause(ts: number | null | undefined): string {
  return ts ? `, due ${fmtDate(ts)}` : "";
}

function assignmentVars(row: LmsAssignmentRow): Record<string, string | number> {
  return {
    learner: row.learnerName || row.learnerEmail,
    learnerEmail: row.learnerEmail,
    course: row.courseName || row.courseLitmosId,
    courseId: row.courseLitmosId,
    dueDate: fmtDate(row.dueDate),
    dueClause: dueClause(row.dueDate),
  };
}

// cycleKey = the due date, so a rescheduled assignment starts a fresh rule-dedupe
// cycle for due_soon/overdue events.
function assignmentEvent(trigger: LmsEvent["trigger"], row: LmsAssignmentRow, teamIds: string[]): LmsEvent {
  return {
    trigger,
    learner: { email: row.learnerEmail, name: row.learnerName, litmosUserId: row.litmosUserId, teamIds },
    course: { litmosId: row.courseLitmosId, name: row.courseName },
    assignment: { id: row.id, dueDate: row.dueDate, score: row.score },
    cycleKey: row.dueDate != null ? String(row.dueDate) : undefined,
  };
}

// Team membership for one learner (poll/webhook paths — low volume, per-event).
async function learnerTeamIds(orgId: string, litmosUserId: string | null | undefined, email?: string | null): Promise<string[]> {
  let lid = litmosUserId ?? null;
  if (!lid && email) {
    const [l] = await db
      .select({ litmosId: lmsLearners.litmosId })
      .from(lmsLearners)
      .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.email, email.trim().toLowerCase())))
      .limit(1);
    lid = l?.litmosId ?? null;
  }
  if (!lid) return [];
  const rows = await db
    .select({ teamLitmosId: lmsTeamMembers.teamLitmosId })
    .from(lmsTeamMembers)
    .where(and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.learnerLitmosId, lid)));
  return rows.map((r) => r.teamLitmosId);
}

// Org-wide lookups the tick reuses across every row (one query each per org).
async function orgLearnerMaps(orgId: string): Promise<{
  teamsByLearner: Map<string, string[]>;
  litmosIdByEmail: Map<string, string>;
  inactiveEmails: Set<string>;
}> {
  const [memberships, learners] = await Promise.all([
    db
      .select({ teamLitmosId: lmsTeamMembers.teamLitmosId, learnerLitmosId: lmsTeamMembers.learnerLitmosId })
      .from(lmsTeamMembers)
      .where(eq(lmsTeamMembers.orgId, orgId)),
    db
      .select({ litmosId: lmsLearners.litmosId, email: lmsLearners.email, active: lmsLearners.active })
      .from(lmsLearners)
      .where(eq(lmsLearners.orgId, orgId)),
  ]);
  const teamsByLearner = new Map<string, string[]>();
  for (const m of memberships) {
    const teams = teamsByLearner.get(m.learnerLitmosId) ?? [];
    teams.push(m.teamLitmosId);
    teamsByLearner.set(m.learnerLitmosId, teams);
  }
  const litmosIdByEmail = new Map<string, string>();
  const inactiveEmails = new Set<string>();
  for (const l of learners) {
    const email = l.email?.toLowerCase();
    if (!email) continue;
    litmosIdByEmail.set(email, l.litmosId);
    if (!l.active) inactiveEmails.add(email);
  }
  return { teamsByLearner, litmosIdByEmail, inactiveEmails };
}

function rowTeamIds(row: LmsAssignmentRow, maps: Awaited<ReturnType<typeof orgLearnerMaps>>): string[] {
  const lid = row.litmosUserId ?? maps.litmosIdByEmail.get(row.learnerEmail) ?? null;
  return lid ? (maps.teamsByLearner.get(lid) ?? []) : [];
}

async function hasEnabledRules(orgId: string, trigger: RuleTrigger): Promise<boolean> {
  const rows = await db
    .select({ id: lmsRules.id })
    .from(lmsRules)
    .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.enabled, true), eq(lmsRules.trigger, trigger)))
    .limit(1);
  return rows.length > 0;
}

// ─── activation ───────────────────────────────────────────────────────────────

export async function activateScheduledLms(): Promise<{ activated: number }> {
  const rows = await db
    .select()
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.status, "scheduled"), sql`${lmsAssignments.scheduledFor} <= ${Date.now()}`))
    .limit(50);
  for (const row of rows) await activateLmsAssignment(row);
  return { activated: rows.length };
}

// ─── completions ──────────────────────────────────────────────────────────────

// Shared post-completion hook (poller + webhook): fire the rule event, then the
// completion notice. Both callees are non-throwing by contract.
async function afterCompletion(orgId: string, row: LmsAssignmentRow): Promise<void> {
  const teamIds = await learnerTeamIds(orgId, row.litmosUserId, row.learnerEmail);
  await fireLmsEvent(orgId, assignmentEvent("assignment.completed", row, teamIds));
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
  // Fair rotation: least-recently-polled first, so a backlog beyond the batch
  // size cycles through instead of starving the same tail forever.
  const rows = await db
    .select()
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.status, "active"), isNull(lmsAssignments.completedAt)))
    .orderBy(sql`${lmsAssignments.lastPolledAt} ASC NULLS FIRST`)
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
      await db.update(lmsAssignments).set({ lastPolledAt: Date.now() }).where(eq(lmsAssignments.id, row.id));
      const result = await getUserCourseResult(creds, row.litmosUserId, row.courseLitmosId);
      if (!result?.CompletedDate) continue;
      const parsed = new Date(result.CompletedDate).getTime();
      // completeLmsAssignment rejects completions older than the assignment's
      // activation (Litmos reports last cycle's result after a re-enrollment).
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
  complianceDeferred: number;
  dailyTruncatedOrgs: number;
}> {
  const [assignmentOrgs, profileOrgs] = await Promise.all([
    db.selectDistinct({ orgId: lmsAssignments.orgId }).from(lmsAssignments),
    db.selectDistinct({ orgId: lmsComplianceProfiles.orgId }).from(lmsComplianceProfiles),
  ]);
  const orgIds = [...new Set([...assignmentOrgs, ...profileOrgs].map((r) => r.orgId))];
  const summary = {
    orgs: orgIds.length,
    overdue: 0,
    reminders: 0,
    complianceEvents: 0,
    reassigned: 0,
    dailyFired: 0,
    complianceDeferred: 0,
    dailyTruncatedOrgs: 0,
  };
  const now = Date.now();

  for (const orgId of orgIds) {
    try {
      const settings = await getLmsSettings(orgId);
      const cadence = parseReminderDays(settings.reminderDays);
      const maps = await orgLearnerMaps(orgId);
      // Deactivated/offboarded learners stop getting direct emails; admin
      // channels still hear about their assignments.
      const learnerTarget = (email: string): string | null => (maps.inactiveEmails.has(email.toLowerCase()) ? null : email);

      // 1. OVERDUE — transition past-due open rows...
      const pastDue = await db
        .select({ id: lmsAssignments.id })
        .from(lmsAssignments)
        .where(and(eq(lmsAssignments.orgId, orgId), inArray(lmsAssignments.status, ["pending", "active"]), lt(lmsAssignments.dueDate, now)));
      if (pastDue.length) {
        await db
          .update(lmsAssignments)
          .set({ status: "overdue", updatedAt: now })
          .where(
            and(
              eq(lmsAssignments.orgId, orgId),
              inArray(
                lmsAssignments.id,
                pastDue.map((r) => r.id),
              ),
            ),
          );
        summary.overdue += pastDue.length;
      }
      // ...then drive effects off the overdue STATE, not the transition: the
      // notice is ledger-gated once per due-date cycle (setLmsDueDate clears the
      // ledger on reschedule), and the rule event re-emits every tick with a
      // fresh daysOverdue so escalation rules ("7+ days overdue") fire at the
      // first tick they match — the cycle-scoped dedupe key caps each rule at
      // one firing per cycle.
      const overdueRows = await db
        .select()
        .from(lmsAssignments)
        .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.status, "overdue"), isNotNull(lmsAssignments.dueDate)))
        .limit(OVERDUE_SCAN_CAP);
      const overdueRulesExist = overdueRows.length ? await hasEnabledRules(orgId, "assignment.overdue") : false;
      for (const row of overdueRows) {
        const daysOverdue = Math.max(1, -daysUntil(row.dueDate!, now));
        const [logged] = await db
          .insert(lmsReminderLog)
          .values({ id: randomUUID(), orgId, assignmentId: row.id, kind: "overdue", bucket: 0, sentAt: now })
          .onConflictDoNothing()
          .returning();
        if (logged) {
          await sendLmsNotice(orgId, "overdue", { ...assignmentVars(row), daysOverdue }, { learnerEmail: learnerTarget(row.learnerEmail) });
        }
        if (overdueRulesExist) {
          await fireLmsEvent(orgId, { ...assignmentEvent("assignment.overdue", row, rowTeamIds(row, maps)), daysOverdue });
        }
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
        await sendLmsNotice(orgId, "due_soon", { ...assignmentVars(row), daysLeft }, { learnerEmail: learnerTarget(row.learnerEmail) });
        await fireLmsEvent(orgId, { ...assignmentEvent("assignment.due_soon", row, rowTeamIds(row, maps)), daysLeft });
        summary.reminders++;
      }

      // 3. COMPLIANCE: refresh statuses, then drive effects off the records'
      // state. Notices are ledger-gated once per (record, expiry cycle); rule
      // events re-emit each tick (cycle-keyed dedupe); auto-reassign relies on
      // the open-assignment guard for idempotency. Externally visible effects
      // are capped per tick so a newly created profile over a large historical
      // cohort rolls out over several ticks instead of blasting hundreds of
      // sends at once.
      await recomputeCompliance(orgId, now);
      const profiles = await db.select().from(lmsComplianceProfiles).where(eq(lmsComplianceProfiles.orgId, orgId));
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const lapsing = await db
        .select()
        .from(lmsComplianceRecords)
        .where(and(eq(lmsComplianceRecords.orgId, orgId), inArray(lmsComplianceRecords.status, ["expiring", "expired"])))
        .orderBy(asc(lmsComplianceRecords.expiresAt))
        .limit(2000);
      const complianceRulesExist = lapsing.length ? await hasEnabledRules(orgId, "compliance.expiring") : false;
      let effectsUsed = 0;
      for (const rec of lapsing) {
        const profile = profileById.get(rec.profileId);
        if (!profile?.enabled || !rec.expiresAt) continue;
        if (effectsUsed >= COMPLIANCE_EFFECTS_CAP) {
          summary.complianceDeferred++;
          continue;
        }
        const courseId = rec.courseLitmosId ?? profile.courseLitmosId;
        const courseName = profile.courseName ?? profile.name;
        const daysToExpiry = daysUntil(rec.expiresAt, now); // negative once lapsed
        const learnerLid = maps.litmosIdByEmail.get(rec.learnerEmail.toLowerCase()) ?? null;
        if (complianceRulesExist) {
          await fireLmsEvent(orgId, {
            trigger: "compliance.expiring",
            learner: { email: rec.learnerEmail, name: rec.learnerName, litmosUserId: learnerLid, teamIds: learnerLid ? (maps.teamsByLearner.get(learnerLid) ?? []) : [] },
            course: { litmosId: courseId, name: courseName },
            daysToExpiry,
            cycleKey: String(rec.expiresAt),
          });
        }
        const [noticed] = await db
          .insert(lmsReminderLog)
          .values({ id: randomUUID(), orgId, assignmentId: `compliance:${rec.id}`, kind: `expiring:${rec.expiresAt}`, bucket: 0, sentAt: now })
          .onConflictDoNothing()
          .returning();
        if (noticed) {
          effectsUsed++;
          summary.complianceEvents++;
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
              dueDate: fmtDate(rec.expiresAt),
              dueClause: dueClause(rec.expiresAt),
            },
            { learnerEmail: learnerTarget(rec.learnerEmail) },
          );
        }
        if (rec.status === "expired" && profile.autoReassign) {
          const dueDate = now + profile.warnDays * DAY_MS;
          // createLmsAssignments' open-assignment dedupe prevents doubles while
          // a previous cycle's reassignment is still open.
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
            effectsUsed++;
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
                dueClause: dueClause(dueDate),
              },
              { learnerEmail: learnerTarget(rec.learnerEmail) },
            );
          }
        }
      }

      // 4. DAILY RULES: fan schedule.daily out to every active learner, paging
      // the full directory (keyset on litmosId) — no silent cap. The rule-run
      // ledger (cycleKey = UTC date) makes this once/learner/day per rule.
      const dailyRulesExist = await hasEnabledRules(orgId, "schedule.daily");
      if (dailyRulesExist) {
        const utcDate = new Date(now).toISOString().slice(0, 10);
        const PAGE = 500;
        const MAX_PAGES = 40;
        let cursor = "";
        for (let page = 0; page < MAX_PAGES; page++) {
          const batch = await db
            .select()
            .from(lmsLearners)
            .where(
              and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.active, true), isNotNull(lmsLearners.email), gt(lmsLearners.litmosId, cursor)),
            )
            .orderBy(asc(lmsLearners.litmosId))
            .limit(PAGE);
          for (const l of batch) {
            if (!l.email) continue;
            const { fired } = await fireLmsEvent(orgId, {
              trigger: "schedule.daily",
              learner: { email: l.email, name: l.fullName, litmosUserId: l.litmosId, teamIds: maps.teamsByLearner.get(l.litmosId) ?? [] },
              cycleKey: utcDate,
            });
            summary.dailyFired += fired;
          }
          if (batch.length < PAGE) break;
          cursor = batch[batch.length - 1].litmosId;
          if (page === MAX_PAGES - 1) summary.dailyTruncatedOrgs++;
        }
      }
    } catch {
      // Per-org: one org's failure must not abort the whole tick.
    }
  }

  return summary;
}
