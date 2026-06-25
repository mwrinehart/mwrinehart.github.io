// Behavior module — server-side read logic. All functions take an explicit
// orgId (resolved by the page via requireTenant) so tenant isolation is never
// implicit. Aggregates are computed in JS; org-sized data is small and this keeps
// the scaffold dependency-light. Heavy aggregation moves to SQL when it matters.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { behaviorPeople, behaviors, pulseFindings, type BehaviorPersonRow } from "./schema";
import type { Severity } from "@/lib/platform/feeds";

export type RiskBand = "low" | "medium" | "high" | "critical";

// Bands align with CBM's high-risk threshold (>= 80 = critical/high-risk).
export function riskBand(score: number): RiskBand {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export async function listPeople(orgId: string): Promise<BehaviorPersonRow[]> {
  return db
    .select()
    .from(behaviorPeople)
    .where(eq(behaviorPeople.orgId, orgId))
    .orderBy(desc(behaviorPeople.riskScore));
}

export interface RiskOverview {
  peopleCount: number;
  avgRisk: number;
  bands: Record<RiskBand, number>;
  topRisers: BehaviorPersonRow[];
  openBehaviors: number;
}

export async function riskOverview(orgId: string): Promise<RiskOverview> {
  const people = await listPeople(orgId);
  const bands: Record<RiskBand, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let total = 0;
  for (const p of people) {
    total += p.riskScore;
    bands[riskBand(p.riskScore)]++;
  }
  const open = await db
    .select({ id: behaviors.id })
    .from(behaviors)
    .where(and(eq(behaviors.orgId, orgId), eq(behaviors.resolved, false)));

  return {
    peopleCount: people.length,
    avgRisk: people.length ? Math.round(total / people.length) : 0,
    bands,
    topRisers: people.slice(0, 5),
    openBehaviors: open.length,
  };
}

export interface BehaviorWithPerson {
  id: string;
  personName: string;
  personEmail: string;
  behaviorType: string | null;
  description: string | null;
  severity: Severity;
  detectedAt: number;
  resolved: boolean;
}

export async function listBehaviors(orgId: string, unresolvedOnly = false): Promise<BehaviorWithPerson[]> {
  const where = unresolvedOnly
    ? and(eq(behaviors.orgId, orgId), eq(behaviors.resolved, false))
    : eq(behaviors.orgId, orgId);
  const rows = await db
    .select({ b: behaviors, p: behaviorPeople })
    .from(behaviors)
    .leftJoin(behaviorPeople, eq(behaviorPeople.id, behaviors.personId))
    .where(where)
    .orderBy(desc(behaviors.detectedAt));
  return rows.map((r) => ({
    id: r.b.id,
    personName: r.p?.name ?? r.p?.email ?? "(unknown)",
    personEmail: r.p?.email ?? "",
    behaviorType: r.b.behaviorType,
    description: r.b.description,
    severity: r.b.severity as Severity,
    detectedAt: r.b.detectedAt,
    resolved: r.b.resolved,
  }));
}

export async function listPulseFindings(orgId: string, limit = 25) {
  return db
    .select()
    .from(pulseFindings)
    .where(eq(pulseFindings.orgId, orgId))
    .orderBy(desc(pulseFindings.scannedAt))
    .limit(limit);
}
