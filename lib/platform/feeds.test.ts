import { describe, expect, it } from "vitest";
import { classifyItem, severityAtLeast, severityRank, type FeedItem, type KeywordRule } from "./feeds";

const item = (title: string, summary = ""): FeedItem => ({
  title,
  summary,
  link: "https://example.com/a",
  publishedAt: null,
  feedName: "Test",
});

describe("severityAtLeast", () => {
  it("orders the four severities", () => {
    expect(severityAtLeast("critical", "high")).toBe(true);
    expect(severityAtLeast("high", "high")).toBe(true);
    expect(severityAtLeast("medium", "high")).toBe(false);
    expect(severityAtLeast("low", "medium")).toBe(false);
  });
});

describe("severityRank", () => {
  it("ranks severities ascending and puts null/unknown below low", () => {
    expect(severityRank("low")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("critical"));
    expect(severityRank(null)).toBeLessThan(severityRank("low"));
    expect(severityRank(undefined)).toBe(-1);
    // @ts-expect-error guarding the runtime path for a bad stored value
    expect(severityRank("bogus")).toBe(-1);
  });
});

describe("classifyItem", () => {
  const rules: KeywordRule[] = [
    { term: "actively exploited", severityFloor: "critical" },
    { term: "cve-", severityFloor: "high" },
    { term: "phish", severityFloor: "medium" },
    { term: "hipaa", category: "regulatory" },
  ];

  it("returns low with no matches", () => {
    const c = classifyItem(item("a quiet day"), rules);
    expect(c.severity).toBe("low");
    expect(c.matched).toEqual([]);
    expect(c.categories).toEqual([]);
  });

  it("takes the highest matched severity floor", () => {
    const c = classifyItem(item("New CVE-2025-0001 actively exploited in the wild"), rules);
    expect(c.severity).toBe("critical");
    expect(c.matched).toContain("actively exploited");
    expect(c.matched).toContain("cve-");
  });

  it("is case-insensitive and tags categories without escalating", () => {
    const c = classifyItem(item("HIPAA guidance update"), rules);
    expect(c.severity).toBe("low"); // category-only rule does not raise severity
    expect(c.categories).toContain("regulatory");
  });

  it("matches against the summary as well as the title", () => {
    const c = classifyItem(item("Notice", "users targeted by a phish campaign"), rules);
    expect(c.severity).toBe("medium");
    expect(c.matched).toContain("phish");
  });
});
