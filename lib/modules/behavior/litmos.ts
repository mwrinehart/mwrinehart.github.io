// Litmos training assignments (ported from CBM litmosAssignments.js). Assign
// courses to people, activate scheduled assignments, poll for completion, and
// accept Litmos completion webhooks (HMAC-verified). The Litmos HTTP calls only
// run when an org has configured its Litmos API key (Sources page) — otherwise
// assignments stay pending/failed gracefully.

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { and, desc, eq, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { findLitmosUserByEmail, getLitmosCreds, litmosFetch } from "@/lib/platform/litmos";
import { getOrgSecret } from "@/lib/platform/secrets";
import { litmosAssignments, type LitmosAssignmentRow } from "./schema";

async function findLitmosUserId(creds: NonNullable<Awaited<ReturnType<typeof getLitmosCreds>>>, email: string): Promise<string | null> {
  const user = await findLitmosUserByEmail(creds, email);
  return user?.Id ? String(user.Id) : null;
}

// ─── reads ────────────────────────────────────────────────────────────────────

export function listAssignments(orgId: string, limit = 200) {
  return db.select().from(litmosAssignments).where(eq(litmosAssignments.orgId, orgId)).orderBy(desc(litmosAssignments.assignedAt)).limit(limit);
}

export async function assignmentStats(orgId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: litmosAssignments.status }).from(litmosAssignments).where(eq(litmosAssignments.orgId, orgId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

// ─── assign ───────────────────────────────────────────────────────────────────

export interface AssignInput {
  userEmail: string;
  userName?: string;
  litmosCourseId: string;
  litmosCourseName?: string;
  scheduledFor?: number;
  dueDate?: number;
}

export async function createAssignments(orgId: string, assignedBy: string, items: AssignInput[]): Promise<number> {
  const now = Date.now();
  let created = 0;
  for (const item of items) {
    if (!item.userEmail || !item.litmosCourseId) continue;
    const scheduled = item.scheduledFor && item.scheduledFor > now;
    const id = randomUUID();
    await db.insert(litmosAssignments).values({
      id,
      orgId,
      userEmail: item.userEmail.toLowerCase(),
      userName: item.userName ?? null,
      litmosCourseId: item.litmosCourseId,
      litmosCourseName: item.litmosCourseName ?? null,
      assignedBy,
      assignedAt: now,
      scheduledFor: item.scheduledFor ?? null,
      dueDate: item.dueDate ?? null,
      status: scheduled ? "scheduled" : "pending",
    });
    created++;
    if (!scheduled) {
      const row = (await db.select().from(litmosAssignments).where(eq(litmosAssignments.id, id)))[0];
      if (row) await activateAssignment(row);
    }
  }
  return created;
}

// Activate one assignment: resolve the Litmos user by email, enroll them in the
// course. Best-effort — failures are recorded on the row, never thrown.
export async function activateAssignment(row: LitmosAssignmentRow): Promise<void> {
  try {
    const creds = await getLitmosCreds(row.orgId);
    if (!creds) {
      await fail(row.id, "Litmos API key not configured");
      return;
    }
    const litmosUserId = await findLitmosUserId(creds, row.userEmail ?? "");
    if (!litmosUserId) {
      await fail(row.id, "user not found in Litmos");
      return;
    }
    const enroll = await litmosFetch(creds, `/users/${litmosUserId}/courses`, {
      method: "POST",
      body: JSON.stringify([{ Id: row.litmosCourseId }]),
    });
    const body = (await enroll.text()).slice(0, 1000);
    if (!enroll.ok) {
      await fail(row.id, `enroll ${enroll.status}: ${body}`);
      return;
    }
    await db
      .update(litmosAssignments)
      .set({ status: "active", activatedAt: Date.now(), litmosUserId, litmosResponse: body })
      .where(eq(litmosAssignments.id, row.id));
  } catch (e) {
    await fail(row.id, e instanceof Error ? e.message : String(e));
  }
}

async function fail(id: string, note: string): Promise<void> {
  await db.update(litmosAssignments).set({ status: "failed", notes: note }).where(eq(litmosAssignments.id, id));
}

export async function cancelAssignment(orgId: string, id: string): Promise<void> {
  await db.update(litmosAssignments).set({ status: "cancelled" }).where(and(eq(litmosAssignments.orgId, orgId), eq(litmosAssignments.id, id)));
}

export async function activateNow(orgId: string, id: string): Promise<void> {
  const row = (await db.select().from(litmosAssignments).where(and(eq(litmosAssignments.orgId, orgId), eq(litmosAssignments.id, id))))[0];
  if (row) await activateAssignment(row);
}

// ─── cron workers (global across orgs) ────────────────────────────────────────

export async function activateScheduled(): Promise<{ activated: number }> {
  const now = Date.now();
  const due = await db
    .select()
    .from(litmosAssignments)
    .where(and(eq(litmosAssignments.status, "scheduled"), lte(litmosAssignments.scheduledFor, now)))
    .limit(50);
  for (const row of due) await activateAssignment(row);
  return { activated: due.length };
}

export async function pollCompletions(): Promise<{ checked: number; completed: number }> {
  const active = await db
    .select()
    .from(litmosAssignments)
    .where(and(eq(litmosAssignments.status, "active"), isNull(litmosAssignments.completedAt)))
    .limit(200);
  let completed = 0;
  for (const row of active) {
    if (!row.litmosUserId) continue;
    try {
      const creds = await getLitmosCreds(row.orgId);
      if (!creds) continue;
      const res = await litmosFetch(creds, `/users/${row.litmosUserId}/courses/${row.litmosCourseId}`);
      if (!res.ok) continue;
      const course = (await res.json()) as { CompletedDate?: string; Score?: number };
      if (course.CompletedDate) {
        // Litmos scores can be decimal (averaged modules); the column is INTEGER.
        const score = typeof course.Score === "number" && Number.isFinite(course.Score) ? Math.round(course.Score) : null;
        await db
          .update(litmosAssignments)
          .set({ status: "completed", completedAt: new Date(course.CompletedDate).getTime(), score })
          .where(eq(litmosAssignments.id, row.id));
        completed++;
      }
    } catch {
      /* skip; retried next tick */
    }
  }
  return { checked: active.length, completed };
}

// ─── completion webhook ───────────────────────────────────────────────────────

// HMAC-SHA256 over `${orgId}:${rawBody}`, keyed by the org's Litmos API key.
export async function verifyCompletionSignature(orgId: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const apiKey = await getOrgSecret(orgId, "litmosApiKey");
  if (!apiKey) return false;
  const expected = createHmac("sha256", apiKey).update(`${orgId}:${rawBody}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CompletionPayload {
  courseId?: string;
  userId?: string;
  email?: string;
  CompletedDate?: string;
  completedAt?: string;
  Score?: number;
  score?: number;
}

export async function handleCompletion(orgId: string, payload: CompletionPayload): Promise<boolean> {
  const courseId = payload.courseId;
  if (!courseId) return false;
  // Cancelled rows stay cancelled, and an exact Litmos-user-id match beats an
  // email match (an email-only hit earlier in the list must not swallow the
  // completion meant for another row).
  const rows = await db
    .select()
    .from(litmosAssignments)
    .where(
      and(
        eq(litmosAssignments.orgId, orgId),
        eq(litmosAssignments.litmosCourseId, courseId),
        isNull(litmosAssignments.completedAt),
        ne(litmosAssignments.status, "cancelled"),
      ),
    );
  const email = payload.email?.toLowerCase();
  const match =
    (payload.userId ? rows.find((r) => r.litmosUserId === payload.userId) : undefined) ??
    (email ? rows.find((r) => r.userEmail === email) : undefined);
  if (!match) return false;
  const when = payload.CompletedDate || payload.completedAt;
  const rawScore = payload.Score ?? payload.score;
  const score = typeof rawScore === "number" && Number.isFinite(rawScore) ? Math.round(rawScore) : null;
  await db
    .update(litmosAssignments)
    .set({ status: "completed", completedAt: when ? new Date(when).getTime() : Date.now(), score })
    .where(eq(litmosAssignments.id, match.id));
  return true;
}
