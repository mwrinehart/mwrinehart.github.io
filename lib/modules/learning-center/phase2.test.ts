// Phase-2 pure-logic tests: tenant root resolution, branding normalization,
// combined-gamification math, certificate eligibility, and API-key auth.

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHexColor, normalizeLogoUrl, tenantRootId } from "./tenant";
import { mergeGamification, totalsByUser } from "./gamify";
import { certificateEligible } from "./certificates";
import type { LcCertificateConfigRow } from "./schema";
import type { LitmosTeam, TeamGamificationEntry } from "./types";

const TEAMS: LitmosTeam[] = [
  { Id: "root", Name: "Meridian", ParentTeamId: null },
  { Id: "a", Name: "Clinical", ParentTeamId: "root" },
  { Id: "a1", Name: "Nursing", ParentTeamId: "a" },
  { Id: "other", Name: "Northwind", ParentTeamId: null },
];

describe("tenantRootId", () => {
  it("walks to the top-level team", () => {
    expect(tenantRootId(TEAMS, "a1")).toBe("root");
    expect(tenantRootId(TEAMS, "a")).toBe("root");
    expect(tenantRootId(TEAMS, "root")).toBe("root");
    expect(tenantRootId(TEAMS, "other")).toBe("other");
  });
  it("returns the id itself for unknown teams", () => {
    expect(tenantRootId(TEAMS, "ghost")).toBe("ghost");
  });
  it("is cycle-safe", () => {
    const cyclic: LitmosTeam[] = [
      { Id: "x", Name: "X", ParentTeamId: "y" },
      { Id: "y", Name: "Y", ParentTeamId: "x" },
    ];
    expect(["x", "y"]).toContain(tenantRootId(cyclic, "x"));
  });
});

describe("branding normalization", () => {
  it("accepts 6-digit hex, rejects the rest", () => {
    expect(normalizeHexColor("#6119E5")).toBe("#6119e5");
    expect(normalizeHexColor("6119E5")).toBeNull();
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
  it("accepts https logo URLs only", () => {
    expect(normalizeLogoUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(normalizeLogoUrl("http://insecure.example.com/logo.png")).toBeNull();
    expect(normalizeLogoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLogoUrl("")).toBeNull();
  });
});

describe("combined gamification", () => {
  const entry = (id: string, points: number, badges: number): TeamGamificationEntry => ({
    UserId: id,
    FirstName: id,
    LastName: "U",
    TotalPointsEarned: points,
    TotalBadgesEarned: badges,
  });

  it("totalsByUser sums points and counts only badge awards", () => {
    const totals = totalsByUser([
      { litmosUserId: "a", points: 100, badgeId: "b1" },
      { litmosUserId: "a", points: 50, badgeId: null },
      { litmosUserId: "b", points: 0, badgeId: "b2" },
    ]);
    expect(totals.get("a")).toEqual({ points: 150, badges: 1 });
    expect(totals.get("b")).toEqual({ points: 0, badges: 1 });
  });

  it("mergeGamification adds award points/badges and a completion bonus", () => {
    const totals = totalsByUser([{ litmosUserId: "a", points: 200, badgeId: "b1" }]);
    const completions = new Map([["a", 3]]);
    const merged = mergeGamification([entry("a", 100, 1)], totals, completions, 10);
    expect(merged[0].TotalPointsEarned).toBe(100 + 200 + 30);
    expect(merged[0].TotalBadgesEarned).toBe(2);
  });

  it("mergeGamification leaves entries without awards unchanged", () => {
    const merged = mergeGamification([entry("z", 40, 0)], new Map());
    expect(merged[0]).toMatchObject({ TotalPointsEarned: 40, TotalBadgesEarned: 0 });
  });

  it("applies the per-completion bonus only when configured (>0)", () => {
    const completions = new Map([["a", 4]]);
    // No bonus by default (pointsPerCompletion defaults to 0).
    expect(mergeGamification([entry("a", 100, 0)], new Map(), completions)[0].TotalPointsEarned).toBe(100);
    // 4 completions × 15 = 60 bonus.
    expect(mergeGamification([entry("a", 100, 0)], new Map(), completions, 15)[0].TotalPointsEarned).toBe(160);
  });
});

describe("certificateEligible", () => {
  const config = (over: Partial<LcCertificateConfigRow>): LcCertificateConfigRow => ({
    teamId: "root",
    enabled: true,
    titleText: "Certificate of Completion",
    messageText: "has completed",
    signerName: null,
    signerTitle: null,
    scope: "all",
    courseIds: "[]",
    learningPathIds: "[]",
    updatedBy: "x",
    updatedAt: 0,
    ...over,
  });

  it("is false when disabled or unconfigured", () => {
    expect(certificateEligible(null, { courseId: "c1" })).toBe(false);
    expect(certificateEligible(config({ enabled: false }), { courseId: "c1" })).toBe(false);
  });
  it("is true for all completions when scope=all", () => {
    expect(certificateEligible(config({ scope: "all" }), { courseId: "anything" })).toBe(true);
  });
  it("respects the selected list when scope=selected", () => {
    const c = config({ scope: "selected", courseIds: JSON.stringify(["c1", "c2"]) });
    expect(certificateEligible(c, { courseId: "c1" })).toBe(true);
    expect(certificateEligible(c, { courseId: "c9" })).toBe(false);
  });
});

describe("API key authentication (hashing + Bearer parsing)", () => {
  afterEach(() => vi.resetModules());

  it("rejects malformed or non-Bearer headers before any DB hit", async () => {
    // db is not mocked; these must short-circuit on shape, never touching it.
    const { authenticateApiKey } = await import("./apikeys");
    await expect(authenticateApiKey(null)).resolves.toBeNull();
    await expect(authenticateApiKey("Basic abc")).resolves.toBeNull();
    await expect(authenticateApiKey("Bearer not-an-lck-token")).resolves.toBeNull();
  });
});
