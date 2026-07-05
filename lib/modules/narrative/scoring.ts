// Pure threat scoring + alert policy for narratives. Transparent arithmetic
// like Compliance's scoreFinding — no opaque ML. `now` is always passed in so
// the functions stay deterministic and unit-testable.

import { severityRank, type Severity } from "@/lib/platform/feeds";

export type Verdict = "unverified" | "false" | "misleading" | "unsubstantiated" | "true";

export const VERDICTS: Verdict[] = ["unverified", "false", "misleading", "unsubstantiated", "true"];

export interface NarrativeSignals {
  verdict: Verdict;
  verdictConfidence: number; // 0-100
  mentionCount: number;
  totalReach: number;
  velocity: number; // mentions seen in the last 24h
  lastSeenAt: number | null;
}

const VERDICT_BASE: Record<Verdict, number> = {
  false: 35,
  misleading: 25,
  unsubstantiated: 15,
  unverified: 10,
  true: 0,
};

const DAY = 86_400_000;

// Composite 0-100 threat score: how false the story is × how fast and far it is
// spreading, decayed when the narrative goes quiet.
export function scoreNarrative(sig: NarrativeSignals, now: number): number {
  let score = VERDICT_BASE[sig.verdict];

  // Confidence sharpens a false/misleading verdict (up to +10).
  if (sig.verdict === "false" || sig.verdict === "misleading") {
    score += Math.round(clamp(sig.verdictConfidence, 0, 100) / 10);
  }

  // Reach tiers (engagement-based audience estimate; RSS-only mentions carry 0
  // reach and contribute via count/velocity instead).
  if (sig.totalReach >= 100_000) score += 20;
  else if (sig.totalReach >= 10_000) score += 15;
  else if (sig.totalReach >= 1_000) score += 10;
  else if (sig.totalReach >= 100) score += 5;

  // Velocity — the "machine speed" signal: how much arrived in the last 24h.
  if (sig.velocity >= 20) score += 20;
  else if (sig.velocity >= 10) score += 15;
  else if (sig.velocity >= 5) score += 10;
  else if (sig.velocity >= 1) score += 5;

  // Breadth: +1 per mention up to 10.
  score += Math.min(10, Math.max(0, sig.mentionCount));

  // Decay when the narrative goes quiet.
  if (sig.lastSeenAt != null) {
    const age = now - sig.lastSeenAt;
    if (age > 30 * DAY) score -= 30;
    else if (age > 7 * DAY) score -= 15;
  }

  // A narrative that checks out true is not a threat regardless of virality.
  if (sig.verdict === "true") return Math.min(5, Math.max(0, Math.round(score)));

  return clamp(Math.round(score), 0, 100);
}

export function severityForScore(score: number): Severity {
  if (score >= 75) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export interface AlertDecision {
  alert: boolean;
  severity: Severity;
}

// Alert policy: a confirmed false/misleading narrative alerts at medium+, and a
// not-yet-verified narrative alerts only once it is spreading hard (high+) so
// analysts see it before verification completes. `alertedSeverity` is the
// narrative's high-water mark — we only re-alert on escalation.
export function alertDecision(sig: NarrativeSignals, score: number, alertedSeverity: Severity | null): AlertDecision {
  const severity = severityForScore(score);
  const confirmedFalse = sig.verdict === "false" || sig.verdict === "misleading";
  const eligible = confirmedFalse
    ? severityRank(severity) >= severityRank("medium")
    : sig.verdict !== "true" && severityRank(severity) >= severityRank("high");
  return { alert: eligible && severityRank(severity) > severityRank(alertedSeverity), severity };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
