import { describe, expect, it } from "vitest";
import { scoreFinding, type FindingSignals, type PreferenceModel } from "./scoring";

const emptyModel: PreferenceModel = { category: {}, feed: {}, keyword: {} };
const NOW = 1_700_000_000_000;
const sig = (over: Partial<FindingSignals> = {}): FindingSignals => ({
  severity: "medium",
  category: null,
  feedName: "Test",
  matched: [],
  publishedAt: null,
  ...over,
});

describe("scoreFinding", () => {
  it("scores higher severity above lower", () => {
    const low = scoreFinding(sig({ severity: "low" }), emptyModel, NOW);
    const crit = scoreFinding(sig({ severity: "critical" }), emptyModel, NOW);
    expect(crit).toBeGreaterThan(low);
  });

  it("stays within 0..100", () => {
    const maxed = scoreFinding(
      sig({ severity: "critical", matched: ["a", "b", "c", "d", "e", "f"], publishedAt: NOW }),
      { category: { Threat: 99 }, feed: { Test: 99 }, keyword: {} },
      NOW,
    );
    expect(maxed).toBeLessThanOrEqual(100);
    expect(maxed).toBeGreaterThanOrEqual(0);
  });

  it("rewards recency", () => {
    const fresh = scoreFinding(sig({ publishedAt: NOW }), emptyModel, NOW);
    const old = scoreFinding(sig({ publishedAt: NOW - 90 * 86_400_000 }), emptyModel, NOW);
    expect(fresh).toBeGreaterThan(old);
  });

  it("applies learned affinity in both directions but bounded", () => {
    const base = scoreFinding(sig({ category: "Privacy" }), emptyModel, NOW);
    const liked = scoreFinding(sig({ category: "Privacy" }), { category: { Privacy: 3 }, feed: {}, keyword: {} }, NOW);
    const disliked = scoreFinding(sig({ category: "Privacy" }), { category: { Privacy: -3 }, feed: {}, keyword: {} }, NOW);
    expect(liked).toBeGreaterThan(base);
    expect(disliked).toBeLessThan(base);
    // Affinity is clamped to ±25, so even an extreme net vote can't swing more than that.
    const extreme = scoreFinding(sig({ category: "Privacy" }), { category: { Privacy: 1000 }, feed: {}, keyword: {} }, NOW);
    expect(extreme - base).toBeLessThanOrEqual(25);
  });
});
