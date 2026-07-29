// Pure-logic tests across the Learning Center's small engines: rule cadence,
// new-member diffing, template rendering, brand picking + gating, leaderboard
// ranking, report summaries, CSV escaping, base-URL normalization.

import { afterEach, describe, expect, it } from "vitest";
import { diffNewMembers, parseIdList, scheduleRuleDue } from "./rules";
import { pickTeamBrand, renderTemplate } from "./notifications";
import { buildLeaderboard, rankSubTeams } from "./leaderboard";
import { summarizeCourses, summarizeCourseUsers, toCsv } from "./reports";
import { duplicateCourseCode } from "./duplicate";
import { isDefaultBrand, normalizeBaseUrl } from "./config";
import type { LitmosCourseUserStatus, LitmosUserCourse, TeamGamificationEntry } from "./types";

const DAY = 86_400_000;

describe("rules engine (pure)", () => {
  it("scheduleRuleDue respects the interval", () => {
    const now = Date.now();
    expect(scheduleRuleDue({ trigger: "schedule", intervalDays: 7, lastRunAt: null }, now)).toBe(true);
    expect(scheduleRuleDue({ trigger: "schedule", intervalDays: 7, lastRunAt: now - 6 * DAY }, now)).toBe(false);
    expect(scheduleRuleDue({ trigger: "schedule", intervalDays: 7, lastRunAt: now - 8 * DAY }, now)).toBe(true);
    expect(scheduleRuleDue({ trigger: "member_joined", intervalDays: 7, lastRunAt: null }, now)).toBe(false);
  });

  it("diffNewMembers returns only unseen ids, deduped", () => {
    expect(diffNewMembers(["a", "b", "b", "c"], ["a"])).toEqual(["b", "c"]);
    expect(diffNewMembers([], ["a"])).toEqual([]);
  });

  it("parseIdList tolerates malformed json", () => {
    expect(parseIdList('["x","y"]')).toEqual(["x", "y"]);
    expect(parseIdList("not json")).toEqual([]);
    expect(parseIdList(null)).toEqual([]);
  });
});

describe("notifications (pure)", () => {
  it("renderTemplate fills placeholders and blanks unknown/missing ones", () => {
    const out = renderTemplate("Hi {{first_name}}, {{course_name}} is due {{due_date}}. {{unknown}}", {
      first_name: "Dana",
      course_name: "HIPAA",
      due_date: null,
    });
    expect(out).toBe("Hi Dana, HIPAA is due . ");
  });

  it("pickTeamBrand picks the dominant non-empty brand", () => {
    expect(pickTeamBrand(["Meridian Health", "Meridian Health", "", null, "Jericho Security"])).toBe("Meridian Health");
    expect(pickTeamBrand(["", null, undefined])).toBeNull();
  });

  it("isDefaultBrand gates Jericho + default brands (env-overridable)", () => {
    const original = process.env.LEARNING_CENTER_DEFAULT_BRANDS;
    delete process.env.LEARNING_CENTER_DEFAULT_BRANDS;
    expect(isDefaultBrand("Jericho Security")).toBe(true);
    expect(isDefaultBrand(null)).toBe(true); // no brand = default brand
    expect(isDefaultBrand("Meridian Health")).toBe(false);
    process.env.LEARNING_CENTER_DEFAULT_BRANDS = "acme corp";
    expect(isDefaultBrand("Acme Corp")).toBe(true);
    expect(isDefaultBrand("Jericho Security")).toBe(false);
    if (original === undefined) delete process.env.LEARNING_CENTER_DEFAULT_BRANDS;
    else process.env.LEARNING_CENTER_DEFAULT_BRANDS = original;
  });
});

describe("leaderboard", () => {
  const entry = (id: string, points: number, badges: number): TeamGamificationEntry => ({
    UserId: id,
    FirstName: id.toUpperCase(),
    LastName: "User",
    TotalPointsEarned: points,
    TotalBadgesEarned: badges,
  });

  it("ranks by points, badges as tiebreaker, shared ranks for full ties", () => {
    const board = buildLeaderboard([entry("a", 100, 1), entry("b", 300, 0), entry("c", 100, 1), entry("d", 100, 2)]);
    expect(board.map((r) => [r.userId, r.rank])).toEqual([
      ["b", 1],
      ["d", 2],
      ["a", 3],
      ["c", 3],
    ]);
  });

  it("ranks sub-teams by average points so small teams compete fairly", () => {
    const standings = rankSubTeams([
      { teamId: "big", teamName: "Big", entries: [entry("a", 100, 0), entry("b", 100, 0), entry("c", 100, 0), entry("d", 100, 0)] },
      { teamId: "small", teamName: "Small", entries: [entry("e", 300, 0)] },
    ]);
    expect(standings[0].teamId).toBe("small");
    expect(standings[0].avgPoints).toBe(300);
    expect(standings[1].totalPoints).toBe(400);
  });
});

describe("report summaries", () => {
  const course = (over: Partial<LitmosUserCourse>): LitmosUserCourse => ({
    Id: "c",
    Name: "C",
    Active: true,
    Complete: false,
    PercentageComplete: 0,
    ...over,
  });

  it("summarizeCourses buckets states and compliance windows", () => {
    const now = Date.now();
    const s = summarizeCourses(
      [
        course({ Complete: true, PercentageComplete: 100, ComplaintTill: new Date(now + 10 * DAY).toISOString() }), // expiring
        course({ PercentageComplete: 40 }),
        course({ Overdue: true }),
        course({ Complete: true, PercentageComplete: 100, ComplaintTill: new Date(now - DAY).toISOString() }), // lapsed
      ],
      now,
    );
    expect(s).toMatchObject({ completed: 2, inProgress: 1, notStarted: 1, overdue: 1, expiringSoon: 1, lapsed: 1 });
  });

  it("summarizeCourseUsers counts due-soon vs overdue", () => {
    const now = Date.now();
    const u = (over: Partial<LitmosCourseUserStatus>): LitmosCourseUserStatus => ({
      Id: "u",
      UserName: "u",
      FirstName: "U",
      LastName: "X",
      Completed: false,
      PercentageComplete: 0,
      ...over,
    });
    const s = summarizeCourseUsers(
      "c1",
      [
        u({ DueDate: new Date(now - DAY).toISOString() }),
        u({ DueDate: new Date(now + 2 * DAY).toISOString() }),
        u({ Completed: true, DueDate: new Date(now - DAY).toISOString() }),
      ],
      now,
    );
    expect(s.overdue).toBe(1);
    expect(s.dueSoon).toBe(1);
    expect(s.completed).toBe(1);
  });

  it("toCsv escapes quotes, commas, and newlines", () => {
    const csv = toCsv([{ name: 'Say "hi", ok?\nline2' }], [{ key: "name", header: "Name" }]);
    expect(csv).toBe('Name\r\n"Say ""hi"", ok?\nline2"\r\n');
  });

  it("toCsv neutralizes spreadsheet formula injection", () => {
    const rows = [{ name: '=HYPERLINK("http://evil","x")' }, { name: "+cmd" }, { name: "-2+3" }, { name: "@SUM(A1)" }, { name: "Normal" }];
    const csv = toCsv(rows, [{ key: "name", header: "Name" }]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://evil"",""x"")"'); // apostrophe-prefixed then quoted
    expect(lines[2]).toBe("'+cmd");
    expect(lines[3]).toBe("'-2+3");
    expect(lines[4]).toBe("'@SUM(A1)");
    expect(lines[5]).toBe("Normal"); // untouched
  });
});

describe("duplicate + config helpers", () => {
  it("duplicateCourseCode is prefixed, slugged, and time-unique", () => {
    const code = duplicateCourseCode("Phishing Foundations!", "Meridian Health", 1234567890);
    expect(code.startsWith("TL-MERIDIAN-HEALTH-PHISHING-FOUNDATIO")).toBe(true);
    expect(code).toContain((1234567890).toString(36).toUpperCase());
  });

  it("normalizeBaseUrl enforces the Litmos host allowlist and /v1.svc suffix", () => {
    expect(normalizeBaseUrl(null)).toBe("https://api.litmos.com/v1.svc");
    expect(normalizeBaseUrl("https://api.litmoseu.com")).toBe("https://api.litmoseu.com/v1.svc");
    expect(normalizeBaseUrl("https://api.litmos.com/v1.svc/")).toBe("https://api.litmos.com/v1.svc");
    // SSRF attempts fall back to the default host
    expect(normalizeBaseUrl("https://evil.example.com/v1.svc")).toBe("https://api.litmos.com/v1.svc");
    expect(normalizeBaseUrl("http://api.litmos.com/v1.svc")).toBe("https://api.litmos.com/v1.svc");
  });
});
