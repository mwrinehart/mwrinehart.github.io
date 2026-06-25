// Compliance frameworks (control evidence) + Maturity assessments. Ported from
// CBM compliance.js + maturity.js. NOTE: this is GRC control tracking — distinct
// from the Compliance MODULE (Horizon), which scans regulatory feeds.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  complianceEvidence,
  complianceFrameworks,
  maturityControls,
  maturityFrameworks,
  maturitySnapshots,
} from "./schema";

// ─── Compliance frameworks + evidence ────────────────────────────────────────

export function listComplianceFrameworks(orgId: string) {
  return db.select().from(complianceFrameworks).where(eq(complianceFrameworks.orgId, orgId));
}

export async function createComplianceFramework(
  orgId: string,
  input: { name: string; version?: string; description?: string; status?: string; score?: number },
): Promise<void> {
  await db.insert(complianceFrameworks).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim(),
    version: input.version ?? null,
    description: input.description ?? null,
    status: input.status ?? "in-progress",
    score: input.score ?? 0,
    createdAt: Date.now(),
  });
}

export function listEvidence(orgId: string, frameworkId?: string) {
  const where = frameworkId
    ? and(eq(complianceEvidence.orgId, orgId), eq(complianceEvidence.frameworkId, frameworkId))
    : eq(complianceEvidence.orgId, orgId);
  return db.select().from(complianceEvidence).where(where).orderBy(desc(complianceEvidence.submittedAt));
}

export async function addEvidence(
  orgId: string,
  input: { frameworkId: string; controlId?: string; description?: string; status?: string },
): Promise<void> {
  await db.insert(complianceEvidence).values({
    id: randomUUID(),
    orgId,
    frameworkId: input.frameworkId,
    controlId: input.controlId ?? null,
    description: input.description ?? null,
    status: input.status ?? "pending",
    submittedAt: Date.now(),
  });
}

// ─── Maturity ─────────────────────────────────────────────────────────────────

export interface MaturityRollup {
  id: string;
  name: string;
  total: number;
  scored: number;
  avgScore: number;
}

export async function listMaturity(orgId: string): Promise<MaturityRollup[]> {
  const frameworks = await db.select().from(maturityFrameworks).where(eq(maturityFrameworks.orgId, orgId));
  const controls = await db.select().from(maturityControls).where(eq(maturityControls.orgId, orgId));
  return frameworks.map((fw) => {
    const own = controls.filter((c) => c.frameworkId === fw.id);
    const scored = own.filter((c) => c.score != null);
    const avg = scored.length ? scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length : 0;
    return { id: fw.id, name: fw.name, total: own.length, scored: scored.length, avgScore: Math.round(avg * 10) / 10 };
  });
}

export async function getMaturityFramework(orgId: string, id: string) {
  const fw = (await db.select().from(maturityFrameworks).where(and(eq(maturityFrameworks.orgId, orgId), eq(maturityFrameworks.id, id))))[0];
  if (!fw) return null;
  const controls = await db.select().from(maturityControls).where(and(eq(maturityControls.orgId, orgId), eq(maturityControls.frameworkId, id)));
  return { framework: fw, controls };
}

export function listMaturityControls(orgId: string) {
  return db.select().from(maturityControls).where(eq(maturityControls.orgId, orgId));
}

export async function createMaturityFramework(orgId: string, input: { name: string; version?: string; description?: string }): Promise<string> {
  const id = randomUUID();
  await db.insert(maturityFrameworks).values({ id, orgId, name: input.name.trim(), version: input.version ?? null, description: input.description ?? null, createdAt: Date.now() });
  return id;
}

export async function addMaturityControl(orgId: string, input: { frameworkId: string; domain?: string; name: string }): Promise<void> {
  await db.insert(maturityControls).values({
    id: randomUUID(),
    orgId,
    frameworkId: input.frameworkId,
    domain: input.domain ?? null,
    name: input.name,
    score: null,
  });
}

export async function updateMaturityControl(orgId: string, controlId: string, input: { score?: number; notes?: string }): Promise<void> {
  const patch: { assessedAt: number; score?: number; notes?: string } = { assessedAt: Date.now() };
  if (input.score != null) patch.score = Math.max(0, Math.min(5, input.score));
  if (input.notes != null) patch.notes = input.notes;
  await db.update(maturityControls).set(patch).where(and(eq(maturityControls.orgId, orgId), eq(maturityControls.id, controlId)));
}

// Record a maturity snapshot for trend tracking (avg of scored controls).
export async function snapshotMaturity(orgId: string, frameworkId: string): Promise<void> {
  const controls = await db.select().from(maturityControls).where(and(eq(maturityControls.orgId, orgId), eq(maturityControls.frameworkId, frameworkId)));
  const scored = controls.filter((c) => c.score != null);
  const avg = scored.length ? Math.round((scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length) * 10) / 10 : 0;
  await db.insert(maturitySnapshots).values({ id: randomUUID(), orgId, frameworkId, avgScore: Math.round(avg), recordedAt: Date.now() });
}
