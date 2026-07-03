// Reports (ported from CBM reports.js). A catalog of report types, an aggregate
// data snapshot across the module's domains, and a saved-reports ledger.

import { randomUUID } from "crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  behaviorPeople,
  behaviors,
  importedCampaignEvents,
  importedLmsRecords,
  policies,
  pulseFindings,
  savedReports,
  triageEmailEvents,
} from "./schema";

export const REPORT_TYPES = [
  { id: "executive", label: "Executive summary" },
  { id: "risk", label: "Risk posture" },
  { id: "compliance", label: "Compliance frameworks" },
  { id: "maturity", label: "Program maturity" },
  { id: "brand", label: "Brand protection" },
  { id: "policy-pulse", label: "Threat pulse" },
  { id: "phishing", label: "Phishing campaigns" },
  { id: "triage-center", label: "Triage center" },
  { id: "litmos-learning", label: "Litmos learning" },
  { id: "user-directory", label: "User directory" },
];

function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface ReportData {
  people: number;
  avgRisk: number;
  policies: number;
  pulseFindings: number;
  openBehaviors: number;
  campaignsByType: Record<string, number>;
  triageByVerdict: Record<string, number>;
  lmsCompleted: number;
}

export async function aggregateReportData(orgId: string): Promise<ReportData> {
  const [people, beh, pol, pulse, campaigns, triage, lms] = await Promise.all([
    db.select({ risk: behaviorPeople.riskScore }).from(behaviorPeople).where(eq(behaviorPeople.orgId, orgId)),
    db.select({ resolved: behaviors.resolved }).from(behaviors).where(eq(behaviors.orgId, orgId)),
    db.select({ id: policies.id }).from(policies).where(eq(policies.orgId, orgId)),
    db.select({ id: pulseFindings.id }).from(pulseFindings).where(eq(pulseFindings.orgId, orgId)),
    db.select({ t: importedCampaignEvents.campaignType }).from(importedCampaignEvents).where(eq(importedCampaignEvents.orgId, orgId)),
    db.select({ v: triageEmailEvents.verdict }).from(triageEmailEvents).where(eq(triageEmailEvents.orgId, orgId)),
    db.select({ status: importedLmsRecords.status }).from(importedLmsRecords).where(eq(importedLmsRecords.orgId, orgId)),
  ]);

  const avgRisk = people.length ? Math.round(people.reduce((s, p) => s + p.risk, 0) / people.length) : 0;
  return {
    people: people.length,
    avgRisk,
    policies: pol.length,
    pulseFindings: pulse.length,
    openBehaviors: beh.filter((b) => !b.resolved).length,
    campaignsByType: tally(campaigns, (c) => c.t),
    triageByVerdict: tally(triage, (t) => t.v),
    lmsCompleted: lms.filter((r) => (r.status ?? "").toLowerCase().includes("complet")).length,
  };
}

export function listSavedReports(orgId: string) {
  return db.select().from(savedReports).where(eq(savedReports.orgId, orgId)).orderBy(desc(savedReports.createdAt)).limit(50);
}

export async function generateReport(orgId: string, input: { type: string; title?: string; format?: string }): Promise<void> {
  await db.insert(savedReports).values({
    id: randomUUID(),
    orgId,
    type: input.type,
    title: input.title ?? REPORT_TYPES.find((t) => t.id === input.type)?.label ?? input.type,
    format: input.format ?? "json",
    status: "ready",
    createdAt: Date.now(),
  });
}

// Risk scores keyed by lowercased email, for cross-module correlation (the LMS
// risk-vs-training report joins on email via app-layer routes).
export async function riskByEmail(orgId: string): Promise<Array<{ email: string; name: string | null; riskScore: number }>> {
  const rows = await db
    .select({ email: behaviorPeople.email, name: behaviorPeople.name, riskScore: behaviorPeople.riskScore })
    .from(behaviorPeople)
    .where(and(eq(behaviorPeople.orgId, orgId), isNotNull(behaviorPeople.email)));
  return rows.map((r) => ({ email: r.email.toLowerCase(), name: r.name, riskScore: r.riskScore }));
}
