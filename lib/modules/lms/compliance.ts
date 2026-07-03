// LMS compliance: named profiles (course + renewal window) and the per-learner
// record table they project onto. recomputeCompliance is the single writer for
// lms_compliance_records and reports status *transitions*, so the cron caller
// can fire events/notices without keeping a separate ledger.

import { randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  lmsAssignments,
  lmsComplianceProfiles,
  lmsComplianceRecords,
  lmsLearners,
  type LmsComplianceProfileRow,
  type LmsComplianceRecordRow,
} from "./schema";
import { complianceExpiry, complianceStatus } from "./types";

const DAY_MS = 86_400_000;

// ─── profiles ─────────────────────────────────────────────────────────────────

export function listComplianceProfiles(orgId: string): Promise<LmsComplianceProfileRow[]> {
  return db.select().from(lmsComplianceProfiles).where(eq(lmsComplianceProfiles.orgId, orgId)).orderBy(asc(lmsComplianceProfiles.name));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export async function upsertComplianceProfile(
  orgId: string,
  input: { id?: string; name: string; courseLitmosId: string; courseName?: string; renewalMonths: number; warnDays: number; autoReassign: boolean; enabled: boolean },
): Promise<void> {
  const now = Date.now();
  const fields = {
    name: input.name,
    courseLitmosId: input.courseLitmosId,
    courseName: input.courseName ?? null,
    renewalMonths: clamp(input.renewalMonths, 1, 120),
    warnDays: clamp(input.warnDays, 0, 365),
    autoReassign: input.autoReassign,
    enabled: input.enabled,
    updatedAt: now,
  };
  if (input.id) {
    await db
      .update(lmsComplianceProfiles)
      .set(fields)
      .where(and(eq(lmsComplianceProfiles.orgId, orgId), eq(lmsComplianceProfiles.id, input.id)));
    return;
  }
  await db.insert(lmsComplianceProfiles).values({ id: randomUUID(), orgId, createdAt: now, ...fields });
}

export async function deleteComplianceProfile(orgId: string, id: string): Promise<void> {
  await db.delete(lmsComplianceRecords).where(and(eq(lmsComplianceRecords.orgId, orgId), eq(lmsComplianceRecords.profileId, id)));
  await db.delete(lmsComplianceProfiles).where(and(eq(lmsComplianceProfiles.orgId, orgId), eq(lmsComplianceProfiles.id, id)));
}

// ─── records ──────────────────────────────────────────────────────────────────

export function listComplianceRecords(orgId: string, opts?: { status?: string; limit?: number }): Promise<LmsComplianceRecordRow[]> {
  const conds = [eq(lmsComplianceRecords.orgId, orgId)];
  if (opts?.status) conds.push(eq(lmsComplianceRecords.status, opts.status));
  return db
    .select()
    .from(lmsComplianceRecords)
    .where(and(...conds))
    .orderBy(sql`${lmsComplianceRecords.expiresAt} asc nulls last`)
    .limit(opts?.limit ?? 500);
}

// Recompute every enabled profile's records from the assignment history. A
// subject is any email that ever had an assignment for the profile's course,
// plus emails already holding a record (so tracked learners aren't dropped).
// Returns only the rows whose status changed INTO expiring/expired this pass.
export async function recomputeCompliance(
  orgId: string,
  now: number = Date.now(),
): Promise<{ records: number; transitionedExpiring: LmsComplianceRecordRow[]; transitionedExpired: LmsComplianceRecordRow[] }> {
  const profiles = await db
    .select()
    .from(lmsComplianceProfiles)
    .where(and(eq(lmsComplianceProfiles.orgId, orgId), eq(lmsComplianceProfiles.enabled, true)));

  // Learner-mirror names win over assignment snapshots (they resync from Litmos).
  const mirror = await db
    .select({ email: lmsLearners.email, fullName: lmsLearners.fullName, firstName: lmsLearners.firstName, lastName: lmsLearners.lastName })
    .from(lmsLearners)
    .where(eq(lmsLearners.orgId, orgId));
  const nameByEmail = new Map<string, string>();
  for (const l of mirror) {
    const email = l.email?.trim().toLowerCase();
    const name = l.fullName ?? ([l.firstName, l.lastName].filter(Boolean).join(" ") || null);
    if (email && name) nameByEmail.set(email, name);
  }

  let records = 0;
  const transitionedExpiring: LmsComplianceRecordRow[] = [];
  const transitionedExpired: LmsComplianceRecordRow[] = [];

  for (const profile of profiles) {
    const assigns = await db
      .select({
        learnerEmail: lmsAssignments.learnerEmail,
        learnerName: lmsAssignments.learnerName,
        status: lmsAssignments.status,
        completedAt: lmsAssignments.completedAt,
      })
      .from(lmsAssignments)
      .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.courseLitmosId, profile.courseLitmosId)))
      .orderBy(asc(lmsAssignments.updatedAt));
    const existing = await db
      .select()
      .from(lmsComplianceRecords)
      .where(and(eq(lmsComplianceRecords.orgId, orgId), eq(lmsComplianceRecords.profileId, profile.id)));
    const prevByEmail = new Map(existing.map((r) => [r.learnerEmail.toLowerCase(), r]));

    const subjects = new Map<string, { name: string | null; lastCompletedAt: number | null }>();
    for (const a of assigns) {
      const email = a.learnerEmail.trim().toLowerCase();
      if (!email) continue;
      const s = subjects.get(email) ?? { name: null, lastCompletedAt: null };
      if (a.learnerName) s.name = a.learnerName; // latest wins (ordered by updatedAt)
      if (a.status === "completed" && a.completedAt && a.completedAt > (s.lastCompletedAt ?? 0)) s.lastCompletedAt = a.completedAt;
      subjects.set(email, s);
    }
    for (const [email, prev] of prevByEmail) {
      if (!subjects.has(email)) subjects.set(email, { name: prev.learnerName, lastCompletedAt: null });
    }

    for (const [email, s] of subjects) {
      const prev = prevByEmail.get(email);
      const status = complianceStatus(s.lastCompletedAt, profile.renewalMonths, profile.warnDays, now);
      const expiresAt = s.lastCompletedAt ? complianceExpiry(s.lastCompletedAt, profile.renewalMonths) : null;
      const learnerName = nameByEmail.get(email) ?? s.name ?? prev?.learnerName ?? null;
      const set = { learnerName, courseLitmosId: profile.courseLitmosId, lastCompletedAt: s.lastCompletedAt, expiresAt, status, updatedAt: now };
      const [row] = await db
        .insert(lmsComplianceRecords)
        .values({ id: randomUUID(), orgId, profileId: profile.id, learnerEmail: email, ...set })
        .onConflictDoUpdate({
          target: [lmsComplianceRecords.orgId, lmsComplianceRecords.profileId, lmsComplianceRecords.learnerEmail],
          set,
        })
        .returning();
      records++;
      if (!row || prev?.status === status) continue;
      if (status === "expiring") transitionedExpiring.push(row);
      if (status === "expired") transitionedExpired.push(row);
    }
  }

  return { records, transitionedExpiring, transitionedExpired };
}

// ─── rollups ──────────────────────────────────────────────────────────────────

// Cumulative expiry windows (in60 includes in30, …), excluding already-expired.
export async function complianceForecast(orgId: string, now: number = Date.now()): Promise<{ in30: number; in60: number; in90: number; expired: number }> {
  const rows = await db
    .select({ expiresAt: lmsComplianceRecords.expiresAt })
    .from(lmsComplianceRecords)
    .where(eq(lmsComplianceRecords.orgId, orgId));
  const out = { in30: 0, in60: 0, in90: 0, expired: 0 };
  for (const r of rows) {
    if (r.expiresAt === null) continue;
    if (r.expiresAt <= now) {
      out.expired++;
      continue;
    }
    const left = r.expiresAt - now;
    if (left <= 30 * DAY_MS) out.in30++;
    if (left <= 60 * DAY_MS) out.in60++;
    if (left <= 90 * DAY_MS) out.in90++;
  }
  return out;
}

export async function lmsComplianceOverview(orgId: string): Promise<{ profiles: number; compliant: number; expiring: number; expired: number; never: number }> {
  const profileRows = await db.select({ id: lmsComplianceProfiles.id }).from(lmsComplianceProfiles).where(eq(lmsComplianceProfiles.orgId, orgId));
  const rows = await db.select({ status: lmsComplianceRecords.status }).from(lmsComplianceRecords).where(eq(lmsComplianceRecords.orgId, orgId));
  const out = { profiles: profileRows.length, compliant: 0, expiring: 0, expired: 0, never: 0 };
  for (const r of rows) {
    if (r.status === "compliant" || r.status === "expiring" || r.status === "expired" || r.status === "never") out[r.status]++;
  }
  return out;
}
