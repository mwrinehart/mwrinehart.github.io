// Litmos training assignments (ported from CBM litmosAssignments.js). Assign
// courses to people, activate scheduled assignments, poll for completion, and
// accept Litmos completion webhooks (HMAC-verified). The Litmos HTTP calls only
// run when an org has configured its Litmos API key (Sources page) — otherwise
// assignments stay pending/failed gracefully.

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { getOrgSecret } from "@/lib/platform/secrets";
import { litmosAssignments, type LitmosAssignmentRow } from "./schema";

interface Creds {
  base: string;
  apiKey: string;
  source: string;
}

async function litmosCreds(orgId: string): Promise<Creds | null> {
  const apiKey = await getOrgSecret(orgId, "litmosApiKey");
  if (!apiKey) return null;
  let base = (await getOrgSecret(orgId, "litmosBaseUrl")) || "https://api.litmos.com/v1.svc";
  if (!base.includes("/v1.svc")) base = base.replace(/\/+$/, "") + "/v1.svc";
  const source = (await getOrgSecret(orgId, "litmosSource")) || "jericho-platform";
  return { base, apiKey, source };
}

async function litmosFetch(creds: Creds, path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${creds.base}${path}${sep}source=${encodeURIComponent(creds.source)}`;
  return fetch(url, {
    ...init,
    headers: { apikey: creds.apiKey, accept: "application/json", "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
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
    const creds = await litmosCreds(row.orgId);
    if (!creds) {
      await fail(row.id, "Litmos API key not configured");
      return;
    }
    const usersRes = await litmosFetch(creds, "/users?limit=200&start=0");
    if (!usersRes.ok) {
      await fail(row.id, `litmos users ${usersRes.status}`);
      return;
    }
    const users = (await usersRes.json()) as Array<{ Id?: string; Email?: string }>;
    const match = users.find((u) => u.Email?.toLowerCase() === row.userEmail);
    if (!match?.Id) {
      await fail(row.id, "user not found in Litmos");
      return;
    }
    const enroll = await litmosFetch(creds, `/users/${match.Id}/courses`, {
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
      .set({ status: "active", activatedAt: Date.now(), litmosUserId: match.Id, litmosResponse: body })
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
      const creds = await litmosCreds(row.orgId);
      if (!creds) continue;
      const res = await litmosFetch(creds, `/users/${row.litmosUserId}/courses/${row.litmosCourseId}`);
      if (!res.ok) continue;
      const course = (await res.json()) as { CompletedDate?: string; Score?: number };
      if (course.CompletedDate) {
        await db
          .update(litmosAssignments)
          .set({ status: "completed", completedAt: new Date(course.CompletedDate).getTime(), score: course.Score ?? null })
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
  const rows = await db
    .select()
    .from(litmosAssignments)
    .where(and(eq(litmosAssignments.orgId, orgId), eq(litmosAssignments.litmosCourseId, courseId), isNull(litmosAssignments.completedAt)));
  const match = rows.find(
    (r) => (payload.userId && r.litmosUserId === payload.userId) || (payload.email && r.userEmail === payload.email.toLowerCase()),
  );
  if (!match) return false;
  const when = payload.CompletedDate || payload.completedAt;
  await db
    .update(litmosAssignments)
    .set({ status: "completed", completedAt: when ? new Date(when).getTime() : Date.now(), score: payload.Score ?? payload.score ?? null })
    .where(eq(litmosAssignments.id, match.id));
  return true;
}
