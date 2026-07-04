import { describe, expect, it } from "vitest";
import { CLUSTER_THRESHOLD, bestMatch, matchedWatchTerms, similarity, tokenize } from "./cluster";

describe("tokenize", () => {
  it("lowercases and drops stopwords", () => {
    expect(tokenize("The BIG Data Breach at Meridian is not new")).toEqual(["big", "data", "breach", "meridian"]);
  });

  it("drops short and numeric noise tokens", () => {
    expect(tokenize("Q3 2024 AI it up")).toEqual([]);
  });
});

describe("similarity", () => {
  it("returns ~1 for identical texts", () => {
    const t = tokenize("Meridian Health hiding a patient data breach");
    expect(similarity(t, t)).toBeCloseTo(1, 6);
  });

  it("returns 0 for disjoint texts", () => {
    const a = tokenize("solar panel efficiency record announced");
    const b = tokenize("quarterly earnings beat analyst expectations");
    expect(similarity(a, b)).toBe(0);
  });

  it("is order-independent", () => {
    const a = tokenize("Whistleblower says Meridian Health is hiding a massive patient data breach");
    const b = tokenize("Meridian Health accused of covering up a patient data breach");
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
  });
});

describe("bestMatch", () => {
  const breach = { id: "n-breach", text: "Whistleblower says Meridian Health is hiding a massive patient data breach" };
  const clinic = { id: "n-clinic", text: "Meridian opens new pediatric clinic in Riverton" };

  it("matches a paraphrased headline about the same story above the threshold", () => {
    const mention = "Meridian Health accused of covering up a patient data breach";
    expect(similarity(tokenize(mention), tokenize(breach.text))).toBeGreaterThan(CLUSTER_THRESHOLD);
    expect(bestMatch(mention, [clinic, breach])).toBe("n-breach");
  });

  it("does not match an unrelated headline to that candidate", () => {
    expect(bestMatch("Meridian opens new pediatric clinic in Riverton", [breach])).toBeNull();
  });

  it("picks the highest-scoring candidate when several clear the threshold", () => {
    const mention = "Meridian Health accused of covering up a patient data breach";
    const closer = { id: "n-closer", text: "Meridian Health covering up patient data breach accusations" };
    // Both candidates clear the threshold; the closer paraphrase must win.
    expect(similarity(tokenize(mention), tokenize(breach.text))).toBeGreaterThan(CLUSTER_THRESHOLD);
    expect(similarity(tokenize(mention), tokenize(closer.text))).toBeGreaterThan(CLUSTER_THRESHOLD);
    expect(bestMatch(mention, [breach, closer])).toBe("n-closer");
    expect(bestMatch(mention, [closer, breach])).toBe("n-closer");
  });
});

describe("matchedWatchTerms", () => {
  it("matches case-insensitive substrings and returns the original terms", () => {
    const text = "BREAKING: Meridian Health hid a data breach from regulators";
    expect(matchedWatchTerms(text, ["meridian health", "BREACH", "acme corp"])).toEqual(["meridian health", "BREACH"]);
  });

  it("ignores empty and whitespace-only terms", () => {
    expect(matchedWatchTerms("anything at all", ["", "   "])).toEqual([]);
  });
});
