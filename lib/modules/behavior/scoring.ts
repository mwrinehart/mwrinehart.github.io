// Risk scoring.
//
// IMPORTANT FIDELITY NOTE: CBM-Next had NO scoring formula — `users.risk_score`
// was written by an external service and the app only read/aggregated it. Because
// the unified platform actually ingests the raw signals (campaign results, triage
// events, behaviors), it DERIVES the score here instead of trusting an opaque
// upstream number. The model is intentionally simple and transparent:
//
//   score = Σ(weight of each unresolved behavior in the last 90d)
//           − 5 per phishing "reported" event (good behavior), floored at 0
//   clamped to 0–100.
//
// Behaviors are synthesized idempotently from campaign "click" events so the
// signal path is: imported events → behaviors → score.

import { and, desc, eq, gte, ilike } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { behaviorPeople, behaviors, importedCampaignEvents, riskScoreHistory } from "./schema";

const SEVERITY_WEIGHT: Record<string, number> = { low: 5, medium: 12, high: 20, critical: 30 };
const WINDOW_MS = 90 * 86_400_000; // 90 days
const REPORT_CREDIT = 5;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Turn campaign "click" events into phish_click behaviors. Deterministic id keyed
// off the campaign event so re-runs never duplicate and manual behaviors are
// untouched.
async function synthesizeBehaviors(orgId: string, emailToId: Map<string, string>): Promise<void> {
  const clicks = await db
    .select()
    .from(importedCampaignEvents)
    .where(and(eq(importedCampaignEvents.orgId, orgId), ilike(importedCampaignEvents.eventType, "%click%")));

  for (const ev of clicks) {
    const personId = ev.userEmail ? emailToId.get(ev.userEmail) : undefined;
    if (!personId) continue;
    await db
      .insert(behaviors)
      .values({
        id: `syn:${ev.externalId}`,
        orgId,
        personId,
        behaviorType: "phish_click",
        description: `Clicked a simulated ${ev.campaignType ?? "phishing"} message${ev.name ? ` (${ev.name})` : ""}`,
        severity: "high",
        detectedAt: ev.eventAt ?? ev.importedAt,
        resolved: false,
      })
      .onConflictDoNothing();
  }
}

// Recompute every person's score for an org and append change-point history.
// Called after each sync and can be triggered manually.
export async function recomputeRiskForOrg(orgId: string): Promise<void> {
  const people = await db
    .select({ id: behaviorPeople.id, email: behaviorPeople.email })
    .from(behaviorPeople)
    .where(eq(behaviorPeople.orgId, orgId));
  if (people.length === 0) return;

  const emailToId = new Map(people.map((p) => [p.email, p.id]));
  await synthesizeBehaviors(orgId, emailToId);

  const cutoff = Date.now() - WINDOW_MS;

  // Sum behavior weights per person (unresolved, recent).
  const openBehaviors = await db
    .select({ personId: behaviors.personId, severity: behaviors.severity, detectedAt: behaviors.detectedAt })
    .from(behaviors)
    .where(and(eq(behaviors.orgId, orgId), eq(behaviors.resolved, false), gte(behaviors.detectedAt, cutoff)));
  const weightByPerson = new Map<string, number>();
  for (const b of openBehaviors) {
    weightByPerson.set(b.personId, (weightByPerson.get(b.personId) ?? 0) + (SEVERITY_WEIGHT[b.severity] ?? 10));
  }

  // Credit "reported" campaign events within the same 90-day window as behavior
  // debits. Window on (eventAt ?? importedAt) — the exact fallback the debit side
  // uses (synthesizeBehaviors) — so events with a null eventAt aren't dropped from
  // credit while still counting toward debit (which would bias scores upward).
  const reports = await db
    .select({ email: importedCampaignEvents.userEmail, eventAt: importedCampaignEvents.eventAt, importedAt: importedCampaignEvents.importedAt })
    .from(importedCampaignEvents)
    .where(and(eq(importedCampaignEvents.orgId, orgId), ilike(importedCampaignEvents.eventType, "%report%")));
  const reportByPerson = new Map<string, number>();
  for (const r of reports) {
    if ((r.eventAt ?? r.importedAt) < cutoff) continue;
    const id = r.email ? emailToId.get(r.email) : undefined;
    if (id) reportByPerson.set(id, (reportByPerson.get(id) ?? 0) + 1);
  }

  const ts = Date.now();
  for (const p of people) {
    const score = clamp((weightByPerson.get(p.id) ?? 0) - REPORT_CREDIT * (reportByPerson.get(p.id) ?? 0));
    await db.update(behaviorPeople).set({ riskScore: score }).where(eq(behaviorPeople.id, p.id));

    // Append history only when the score changed (keeps history as change-points).
    const last = await db
      .select({ score: riskScoreHistory.score })
      .from(riskScoreHistory)
      .where(and(eq(riskScoreHistory.orgId, orgId), eq(riskScoreHistory.personId, p.id)))
      .orderBy(desc(riskScoreHistory.recordedAt))
      .limit(1);
    if (!last[0] || last[0].score !== score) {
      await db
        .insert(riskScoreHistory)
        .values({ id: `${p.id}:${ts}`, orgId, personId: p.id, score, recordedAt: ts });
    }
  }
}

export interface TrendPoint {
  date: string;
  avg: number;
}

// Org-level average score over time (daily), plus a direction label — mirrors
// CBM's increasing/decreasing/stable classification but at the org level.
export async function getOrgRiskTrend(orgId: string): Promise<{ direction: "increasing" | "decreasing" | "stable"; points: TrendPoint[] }> {
  const rows = await db
    .select({ score: riskScoreHistory.score, recordedAt: riskScoreHistory.recordedAt })
    .from(riskScoreHistory)
    .where(eq(riskScoreHistory.orgId, orgId));

  const byDay = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const day = new Date(r.recordedAt).toISOString().slice(0, 10);
    const acc = byDay.get(day) ?? { sum: 0, n: 0 };
    acc.sum += r.score;
    acc.n += 1;
    byDay.set(day, acc);
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, n }]) => ({ date, avg: Math.round(sum / n) }));

  // Direction from a least-squares slope over ALL points (avg per bucket), not
  // just the two endpoints, so a spike-then-recover reads correctly. (Buckets are
  // UTC days; per-org timezone is a follow-up once orgs carry a tz.)
  let direction: "increasing" | "decreasing" | "stable" = "stable";
  if (points.length >= 2) {
    const n = points.length;
    const meanX = (n - 1) / 2;
    const meanY = points.reduce((s, p) => s + p.avg, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (points[i].avg - meanY);
      den += (i - meanX) ** 2;
    }
    const slope = den ? num / den : 0; // avg-score change per day-bucket
    direction = slope > 0.5 ? "increasing" : slope < -0.5 ? "decreasing" : "stable";
  }
  return { direction, points };
}
