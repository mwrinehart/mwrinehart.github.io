// LMS assignments (modeled on behavior/litmos.ts, against lms_assignments).
// Create/dedupe assignments, activate them in Litmos via the shared platform
// client, and record completions/due-date changes. Leaf module file: rule events
// and notices are fired by callers, never from here.

import { randomUUID } from "crypto";
import { and, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { assignUserCourses, findLitmosUserByEmail, getLitmosCreds } from "@/lib/platform/litmos";
import { lmsAssignments, lmsCourses, lmsLearners, lmsReminderLog, lmsTeamMembers, type LmsAssignmentRow } from "./schema";
import { OPEN_ASSIGNMENT_STATUSES } from "./types";

// ─── reads ────────────────────────────────────────────────────────────────────

export function listLmsAssignments(
  orgId: string,
  opts?: { status?: string; courseId?: string; q?: string; limit?: number },
): Promise<LmsAssignmentRow[]> {
  const conds: (SQL | undefined)[] = [eq(lmsAssignments.orgId, orgId)];
  if (opts?.status) conds.push(eq(lmsAssignments.status, opts.status));
  if (opts?.courseId) conds.push(eq(lmsAssignments.courseLitmosId, opts.courseId));
  if (opts?.q) {
    const pattern = `%${opts.q}%`;
    conds.push(or(ilike(lmsAssignments.learnerEmail, pattern), ilike(lmsAssignments.learnerName, pattern), ilike(lmsAssignments.courseName, pattern)));
  }
  return db
    .select()
    .from(lmsAssignments)
    .where(and(...conds))
    .orderBy(desc(lmsAssignments.assignedAt))
    .limit(opts?.limit ?? 200);
}

export async function lmsAssignmentStats(orgId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: lmsAssignments.status }).from(lmsAssignments).where(eq(lmsAssignments.orgId, orgId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

// ─── assign ───────────────────────────────────────────────────────────────────

export interface LmsAssignInput {
  learnerEmail: string;
  learnerName?: string;
  courseLitmosId: string;
  courseName?: string;
  scheduledFor?: number;
  dueDate?: number;
  assignedBy?: string;
  ruleId?: string;
}

export async function createLmsAssignments(orgId: string, items: LmsAssignInput[]): Promise<{ created: number; skipped: number }> {
  const now = Date.now();
  let created = 0;
  let skipped = 0;
  const seen = new Set<string>(); // dedupe within the batch too (team assigns)
  for (const item of items) {
    const email = item.learnerEmail?.trim().toLowerCase();
    if (!email || !item.courseLitmosId) {
      skipped++;
      continue;
    }
    const key = `${email}:${item.courseLitmosId}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const open = await db
      .select({ id: lmsAssignments.id })
      .from(lmsAssignments)
      .where(
        and(
          eq(lmsAssignments.orgId, orgId),
          eq(lmsAssignments.learnerEmail, email),
          eq(lmsAssignments.courseLitmosId, item.courseLitmosId),
          inArray(lmsAssignments.status, OPEN_ASSIGNMENT_STATUSES),
        ),
      )
      .limit(1);
    if (open.length) {
      skipped++;
      continue;
    }
    const scheduled = !!item.scheduledFor && item.scheduledFor > now;
    const [row] = await db
      .insert(lmsAssignments)
      .values({
        id: randomUUID(),
        orgId,
        learnerEmail: email,
        learnerName: item.learnerName ?? null,
        courseLitmosId: item.courseLitmosId,
        courseName: item.courseName ?? null,
        assignedBy: item.assignedBy ?? null,
        ruleId: item.ruleId ?? null,
        assignedAt: now,
        scheduledFor: item.scheduledFor ?? null,
        dueDate: item.dueDate ?? null,
        status: scheduled ? "scheduled" : "pending",
        updatedAt: now,
      })
      .returning();
    created++;
    if (!scheduled && row) await activateLmsAssignment(row);
  }
  return { created, skipped };
}

// Activate one assignment: resolve the Litmos user by email, enroll them in the
// course. Best-effort — failures are recorded on the row, never thrown.
export async function activateLmsAssignment(row: LmsAssignmentRow): Promise<void> {
  try {
    const creds = await getLitmosCreds(row.orgId);
    if (!creds) {
      await fail(row.orgId, row.id, "Litmos API key not configured");
      return;
    }
    const user = await findLitmosUserByEmail(creds, row.learnerEmail);
    if (!user?.Id) {
      await fail(row.orgId, row.id, "user not found in Litmos");
      return;
    }
    const litmosUserId = String(user.Id);
    const body = await assignUserCourses(creds, litmosUserId, [row.courseLitmosId]);
    await db
      .update(lmsAssignments)
      .set({ status: "active", activatedAt: Date.now(), litmosUserId, litmosResponse: body, updatedAt: Date.now() })
      .where(and(eq(lmsAssignments.orgId, row.orgId), eq(lmsAssignments.id, row.id)));
  } catch (e) {
    await fail(row.orgId, row.id, e instanceof Error ? e.message : String(e));
  }
}

async function fail(orgId: string, id: string, note: string): Promise<void> {
  await db
    .update(lmsAssignments)
    .set({ status: "failed", notes: note, updatedAt: Date.now() })
    .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, id)));
}

export async function cancelLmsAssignment(orgId: string, id: string): Promise<void> {
  await db
    .update(lmsAssignments)
    .set({ status: "cancelled", updatedAt: Date.now() })
    .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, id)));
}

export async function activateLmsNow(orgId: string, id: string): Promise<void> {
  const row = (await db.select().from(lmsAssignments).where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, id))))[0];
  if (row) await activateLmsAssignment(row);
}

// Moving an overdue row's due date into the future flips it back to active.
export async function setLmsDueDate(orgId: string, id: string, dueDate: number | null): Promise<void> {
  const row = (await db.select().from(lmsAssignments).where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, id))))[0];
  if (!row) return;
  const patch: Partial<typeof lmsAssignments.$inferInsert> = { dueDate, updatedAt: Date.now() };
  if (row.status === "overdue" && dueDate !== null && dueDate > Date.now()) patch.status = "active";
  await db
    .update(lmsAssignments)
    .set(patch)
    .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, id)));
  // A changed due date starts a new reminder cycle: clear the consumed ledger
  // rows so the new deadline gets its own due-soon buckets and overdue notice.
  if (dueDate !== row.dueDate) {
    await db.delete(lmsReminderLog).where(and(eq(lmsReminderLog.orgId, orgId), eq(lmsReminderLog.assignmentId, id)));
  }
}

// ─── team assign ──────────────────────────────────────────────────────────────

export async function assignCourseToTeam(
  orgId: string,
  teamLitmosId: string,
  courseLitmosId: string,
  opts?: { dueDate?: number; assignedBy?: string },
): Promise<{ created: number; skipped: number }> {
  const members = await db
    .select({ email: lmsLearners.email, fullName: lmsLearners.fullName, firstName: lmsLearners.firstName, lastName: lmsLearners.lastName })
    .from(lmsTeamMembers)
    .innerJoin(lmsLearners, and(eq(lmsLearners.orgId, lmsTeamMembers.orgId), eq(lmsLearners.litmosId, lmsTeamMembers.learnerLitmosId)))
    .where(and(eq(lmsTeamMembers.orgId, orgId), eq(lmsTeamMembers.teamLitmosId, teamLitmosId), eq(lmsLearners.active, true)));
  const course = (
    await db.select({ name: lmsCourses.name }).from(lmsCourses).where(and(eq(lmsCourses.orgId, orgId), eq(lmsCourses.litmosId, courseLitmosId)))
  )[0];
  const items: LmsAssignInput[] = [];
  for (const m of members) {
    const email = m.email?.trim();
    if (!email) continue;
    items.push({
      learnerEmail: email,
      learnerName: m.fullName ?? ([m.firstName, m.lastName].filter(Boolean).join(" ") || undefined),
      courseLitmosId,
      courseName: course?.name,
      dueDate: opts?.dueDate,
      assignedBy: opts?.assignedBy,
    });
  }
  return createLmsAssignments(orgId, items);
}

// ─── completion ───────────────────────────────────────────────────────────────

// Litmos keeps a user's course result across re-enrollments, so a completion
// that predates the assignment's activation is last cycle's result, not this
// one's — accepting it would instantly "complete" every re-assignment (and let
// compliance auto-reassign self-complete forever). Small grace for clock skew.
const COMPLETION_SKEW_MS = 5 * 60 * 1000;

// Mark the open assignment for a course completed, matching by Litmos user id
// first, then lowercased email — newest assignment first, live (open) rows only,
// so a stale failed row can't swallow the completion. Returns the updated row
// (so callers can fire events/notices) or null when nothing matched.
export async function completeLmsAssignment(
  orgId: string,
  match: { courseId: string; litmosUserId?: string | null; email?: string | null },
  completion: { completedAt?: number; score?: number | null },
): Promise<LmsAssignmentRow | null> {
  const rows = await db
    .select()
    .from(lmsAssignments)
    .where(
      and(
        eq(lmsAssignments.orgId, orgId),
        eq(lmsAssignments.courseLitmosId, match.courseId),
        isNull(lmsAssignments.completedAt),
        inArray(lmsAssignments.status, OPEN_ASSIGNMENT_STATUSES),
      ),
    )
    .orderBy(desc(lmsAssignments.assignedAt));
  const email = match.email?.trim().toLowerCase();
  const hit =
    (match.litmosUserId ? rows.find((r) => r.litmosUserId === match.litmosUserId) : undefined) ??
    (email ? rows.find((r) => r.learnerEmail === email) : undefined);
  if (!hit) return null;
  const completedAt = completion.completedAt ?? Date.now();
  if (completedAt < (hit.activatedAt ?? hit.assignedAt) - COMPLETION_SKEW_MS) return null;
  const score = completion.score === null || completion.score === undefined || !Number.isFinite(completion.score) ? null : Math.round(completion.score);
  const [updated] = await db
    .update(lmsAssignments)
    .set({ status: "completed", completedAt, score, updatedAt: Date.now() })
    .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.id, hit.id)))
    .returning();
  return updated ?? null;
}
