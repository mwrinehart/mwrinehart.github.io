import { describe, expect, it } from "vitest";
import { alertDecision, scoreNarrative, severityForScore, type NarrativeSignals } from "./scoring";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const sig = (over: Partial<NarrativeSignals> = {}): NarrativeSignals => ({
  verdict: "unverified",
  verdictConfidence: 50,
  mentionCount: 1,
  totalReach: 0,
  velocity: 0,
  lastSeenAt: NOW,
  ...over,
});

describe("scoreNarrative", () => {
  it("orders verdicts false > misleading > unsubstantiated > unverified under identical spread", () => {
    const spread: Partial<NarrativeSignals> = { verdictConfidence: 80, mentionCount: 4, totalReach: 5_000, velocity: 6 };
    const score = (verdict: NarrativeSignals["verdict"]) => scoreNarrative(sig({ ...spread, verdict }), NOW);
    expect(score("false")).toBeGreaterThan(score("misleading"));
    expect(score("misleading")).toBeGreaterThan(score("unsubstantiated"));
    expect(score("unsubstantiated")).toBeGreaterThan(score("unverified"));
  });

  it('caps a "true" verdict at 5 even with huge reach and velocity', () => {
    const viral = scoreNarrative(
      sig({ verdict: "true", verdictConfidence: 100, mentionCount: 500, totalReach: 5_000_000, velocity: 200 }),
      NOW,
    );
    expect(viral).toBeLessThanOrEqual(5);
    expect(viral).toBeGreaterThanOrEqual(0);
  });

  it("scores monotonically across reach tiers", () => {
    const tiers = [0, 100, 1_000, 10_000, 100_000];
    const scores = tiers.map((totalReach) => scoreNarrative(sig({ verdict: "false", totalReach }), NOW));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it("scores monotonically across velocity tiers", () => {
    const tiers = [0, 1, 5, 10, 20];
    const scores = tiers.map((velocity) => scoreNarrative(sig({ verdict: "false", velocity }), NOW));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it("decays quiet narratives at 7 and 30 days", () => {
    const base: Partial<NarrativeSignals> = { verdict: "false", verdictConfidence: 80, totalReach: 10_000, velocity: 0 };
    const fresh = scoreNarrative(sig({ ...base, lastSeenAt: NOW }), NOW);
    const weekOld = scoreNarrative(sig({ ...base, lastSeenAt: NOW - 8 * DAY }), NOW);
    const monthOld = scoreNarrative(sig({ ...base, lastSeenAt: NOW - 31 * DAY }), NOW);
    expect(weekOld).toBeLessThan(fresh);
    expect(monthOld).toBeLessThan(weekOld);
  });

  it("stays within 0..100 for extreme inputs", () => {
    const maxed = scoreNarrative(
      sig({
        verdict: "false",
        verdictConfidence: Number.MAX_SAFE_INTEGER,
        mentionCount: 1_000_000,
        totalReach: Number.MAX_SAFE_INTEGER,
        velocity: 1_000_000,
        lastSeenAt: NOW,
      }),
      NOW,
    );
    expect(maxed).toBeLessThanOrEqual(100);
    expect(maxed).toBeGreaterThanOrEqual(0);

    const floored = scoreNarrative(
      sig({
        verdict: "unverified",
        verdictConfidence: -500,
        mentionCount: -10,
        totalReach: -5,
        velocity: -5,
        lastSeenAt: NOW - 365 * DAY,
      }),
      NOW,
    );
    expect(floored).toBeGreaterThanOrEqual(0);
    expect(floored).toBeLessThanOrEqual(100);
  });
});

describe("severityForScore", () => {
  it("maps scores to severities at the documented boundaries", () => {
    expect(severityForScore(29)).toBe("low");
    expect(severityForScore(30)).toBe("medium");
    expect(severityForScore(54)).toBe("medium");
    expect(severityForScore(55)).toBe("high");
    expect(severityForScore(74)).toBe("high");
    expect(severityForScore(75)).toBe("critical");
  });
});

describe("alertDecision", () => {
  it("alerts on a false verdict at medium severity", () => {
    const d = alertDecision(sig({ verdict: "false" }), 40, null);
    expect(d.severity).toBe("medium");
    expect(d.alert).toBe(true);
  });

  it("does not alert on an unverified narrative at medium severity", () => {
    const d = alertDecision(sig({ verdict: "unverified" }), 40, null);
    expect(d.severity).toBe("medium");
    expect(d.alert).toBe(false);
  });

  it("alerts on an unverified narrative once it reaches high severity", () => {
    const d = alertDecision(sig({ verdict: "unverified" }), 60, null);
    expect(d.severity).toBe("high");
    expect(d.alert).toBe(true);
  });

  it("never alerts on a true verdict, whatever the score", () => {
    for (const score of [40, 60, 95]) {
      expect(alertDecision(sig({ verdict: "true" }), score, null).alert).toBe(false);
    }
  });

  it("suppresses re-alerts at the high-water mark but allows escalation past it", () => {
    // Already alerted at medium; the same severity does not re-alert.
    expect(alertDecision(sig({ verdict: "false" }), 40, "medium").alert).toBe(false);
    expect(alertDecision(sig({ verdict: "false" }), 60, "high").alert).toBe(false);
    // A lower high-water mark lets a bigger score escalate.
    const escalated = alertDecision(sig({ verdict: "false" }), 80, "medium");
    expect(escalated.severity).toBe("critical");
    expect(escalated.alert).toBe(true);
  });
});
