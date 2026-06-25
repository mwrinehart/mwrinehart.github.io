// Composite relevance scoring + feedback learning (rebuilt from Horizon's
// scoring + finding_feedback). A finding's score (0–100) combines severity,
// keyword density, recency, and a learned preference model built from the org's
// useful/not-useful votes — so findings like the ones a team marked useful float
// to the top over time. All transparent arithmetic; no opaque ML.

import { eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import type { Severity } from "@/lib/platform/feeds";
import { complianceFeedback } from "./schema";

const SEVERITY_BASE: Record<Severity, number> = { low: 4, medium: 12, high: 25, critical: 40 };

export interface PreferenceModel {
  category: Record<string, number>;
  feed: Record<string, number>;
  keyword: Record<string, number>;
}

// Aggregate the org's votes into net-affinity maps (useful = +1, not_useful = -1).
export async function buildPreferenceModel(orgId: string): Promise<PreferenceModel> {
  const votes = await db.select().from(complianceFeedback).where(eq(complianceFeedback.orgId, orgId));
  const model: PreferenceModel = { category: {}, feed: {}, keyword: {} };
  for (const v of votes) {
    const delta = v.vote === "useful" ? 1 : -1;
    if (v.category) model.category[v.category] = (model.category[v.category] ?? 0) + delta;
    if (v.feedName) model.feed[v.feedName] = (model.feed[v.feedName] ?? 0) + delta;
    for (const k of (v.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      model.keyword[k] = (model.keyword[k] ?? 0) + delta;
    }
  }
  return model;
}

export interface FindingSignals {
  severity: Severity;
  category: string | null;
  feedName: string;
  matched: string[];
  publishedAt: number | null;
}

export function scoreFinding(sig: FindingSignals, model: PreferenceModel, now: number): number {
  let score = SEVERITY_BASE[sig.severity] ?? 10;

  // Keyword density (capped).
  score += Math.min(20, sig.matched.length * 4);

  // Recency.
  if (sig.publishedAt) {
    const days = (now - sig.publishedAt) / 86_400_000;
    if (days <= 1) score += 15;
    else if (days <= 7) score += 8;
    else if (days <= 30) score += 3;
  }

  // Learned feedback affinity (bounded so it tunes, not dominates).
  let aff = 0;
  if (sig.category && model.category[sig.category]) aff += model.category[sig.category] * 5;
  if (model.feed[sig.feedName]) aff += model.feed[sig.feedName] * 3;
  for (const k of sig.matched) if (model.keyword[k]) aff += model.keyword[k] * 2;
  score += Math.max(-25, Math.min(25, aff));

  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface Learnings {
  favoredCategories: Array<{ name: string; net: number }>;
  favoredFeeds: Array<{ name: string; net: number }>;
}

export async function getLearnings(orgId: string): Promise<Learnings> {
  const model = await buildPreferenceModel(orgId);
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([name, net]) => ({ name, net }))
      .filter((e) => e.net !== 0)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 6);
  return { favoredCategories: top(model.category), favoredFeeds: top(model.feed) };
}
