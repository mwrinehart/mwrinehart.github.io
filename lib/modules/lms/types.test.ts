import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_DAYS,
  OPEN_ASSIGNMENT_STATUSES,
  assignmentBadgeTone,
  coerceRuleAction,
  complianceExpiry,
  complianceStatus,
  courseGradient,
  courseHue,
  courseInitials,
  daysUntil,
  eventDedupeKey,
  parseReminderDays,
  parseRuleActions,
  parseRuleConditions,
  reminderBucket,
  renderTemplate,
  ruleMatches,
  toCsv,
  type LmsEvent,
} from "./types";

const DAY_MS = 86_400_000;

const event = (over: Partial<LmsEvent> = {}): LmsEvent => ({
  trigger: "assignment.completed",
  learner: { email: "alice@corp.com", teamIds: ["t1", "t2"] },
  course: { litmosId: "c1", name: "Security 101" },
  assignment: { id: "a1", score: 80 },
  ...over,
});

describe("ruleMatches", () => {
  it("passes with empty conditions", () => {
    expect(ruleMatches({}, event())).toBe(true);
    expect(ruleMatches({}, { trigger: "schedule.daily" })).toBe(true);
  });

  it("teamIds is any-of over the learner's teams", () => {
    expect(ruleMatches({ teamIds: ["t2", "t9"] }, event())).toBe(true);
    expect(ruleMatches({ teamIds: ["t9"] }, event())).toBe(false);
  });

  it("teamIds fails closed when the event has no learner or teams", () => {
    expect(ruleMatches({ teamIds: ["t1"] }, event({ learner: undefined }))).toBe(false);
    expect(ruleMatches({ teamIds: ["t1"] }, event({ learner: { email: "alice@corp.com" } }))).toBe(false);
  });

  it("emailDomains matches case-insensitively against the learner email", () => {
    expect(ruleMatches({ emailDomains: ["corp.com"] }, event({ learner: { email: "Alice@CORP.COM" } }))).toBe(true);
    expect(ruleMatches({ emailDomains: ["other.com"] }, event())).toBe(false);
    expect(ruleMatches({ emailDomains: ["corp.com"] }, event({ learner: undefined }))).toBe(false);
  });

  it("emailDomains works end-to-end with @-prefixed mixed-case persisted conditions", () => {
    const conditions = parseRuleConditions('{"emailDomains":["@Corp.COM"]}');
    expect(ruleMatches(conditions, event({ learner: { email: "Alice@corp.com" } }))).toBe(true);
    expect(ruleMatches(conditions, event({ learner: { email: "bob@elsewhere.com" } }))).toBe(false);
  });

  it("courseIds gates on the event course and fails closed without one", () => {
    expect(ruleMatches({ courseIds: ["c1", "c2"] }, event())).toBe(true);
    expect(ruleMatches({ courseIds: ["c2"] }, event())).toBe(false);
    expect(ruleMatches({ courseIds: ["c1"] }, event({ course: undefined }))).toBe(false);
  });

  it("maxDaysLeft is inclusive at the boundary and fails closed without daysLeft", () => {
    expect(ruleMatches({ maxDaysLeft: 7 }, event({ daysLeft: 7 }))).toBe(true);
    expect(ruleMatches({ maxDaysLeft: 7 }, event({ daysLeft: 3 }))).toBe(true);
    expect(ruleMatches({ maxDaysLeft: 7 }, event({ daysLeft: 8 }))).toBe(false);
    expect(ruleMatches({ maxDaysLeft: 7 }, event())).toBe(false);
  });

  it("minDaysOverdue is inclusive at the boundary and fails closed without daysOverdue", () => {
    expect(ruleMatches({ minDaysOverdue: 3 }, event({ daysOverdue: 3 }))).toBe(true);
    expect(ruleMatches({ minDaysOverdue: 3 }, event({ daysOverdue: 10 }))).toBe(true);
    expect(ruleMatches({ minDaysOverdue: 3 }, event({ daysOverdue: 2 }))).toBe(false);
    expect(ruleMatches({ minDaysOverdue: 3 }, event())).toBe(false);
  });

  it("maxDaysToExpiry supports negative thresholds (already lapsed)", () => {
    expect(ruleMatches({ maxDaysToExpiry: 30 }, event({ daysToExpiry: 30 }))).toBe(true);
    expect(ruleMatches({ maxDaysToExpiry: 30 }, event({ daysToExpiry: -5 }))).toBe(true);
    expect(ruleMatches({ maxDaysToExpiry: 30 }, event({ daysToExpiry: 31 }))).toBe(false);
    expect(ruleMatches({ maxDaysToExpiry: -1 }, event({ daysToExpiry: -1 }))).toBe(true);
    expect(ruleMatches({ maxDaysToExpiry: -1 }, event({ daysToExpiry: 0 }))).toBe(false);
    expect(ruleMatches({ maxDaysToExpiry: 30 }, event())).toBe(false);
  });

  it("minScore/maxScore are inclusive and a null/missing score fails", () => {
    expect(ruleMatches({ minScore: 80 }, event({ assignment: { id: "a1", score: 80 } }))).toBe(true);
    expect(ruleMatches({ minScore: 80 }, event({ assignment: { id: "a1", score: 79 } }))).toBe(false);
    expect(ruleMatches({ maxScore: 80 }, event({ assignment: { id: "a1", score: 80 } }))).toBe(true);
    expect(ruleMatches({ maxScore: 80 }, event({ assignment: { id: "a1", score: 81 } }))).toBe(false);
    expect(ruleMatches({ minScore: 0 }, event({ assignment: { id: "a1", score: null } }))).toBe(false);
    expect(ruleMatches({ maxScore: 100 }, event({ assignment: { id: "a1", score: null } }))).toBe(false);
    expect(ruleMatches({ minScore: 0 }, event({ assignment: undefined }))).toBe(false);
    expect(ruleMatches({ maxScore: 100 }, event({ assignment: undefined }))).toBe(false);
  });

  it("ANDs all conditions together", () => {
    const conditions = { teamIds: ["t1"], emailDomains: ["corp.com"], courseIds: ["c1"], minScore: 70 };
    expect(ruleMatches(conditions, event())).toBe(true);
    expect(ruleMatches(conditions, event({ learner: { email: "alice@corp.com", teamIds: ["t9"] } }))).toBe(false);
    expect(ruleMatches(conditions, event({ course: { litmosId: "c2" } }))).toBe(false);
    expect(ruleMatches(conditions, event({ assignment: { id: "a1", score: 69 } }))).toBe(false);
  });
});

describe("parseRuleConditions", () => {
  it("returns {} for null, garbage, and non-object JSON", () => {
    expect(parseRuleConditions(null)).toEqual({});
    expect(parseRuleConditions(undefined)).toEqual({});
    expect(parseRuleConditions("")).toEqual({});
    expect(parseRuleConditions("not json")).toEqual({});
    expect(parseRuleConditions("null")).toEqual({});
    expect(parseRuleConditions("42")).toEqual({});
    expect(parseRuleConditions('"str"')).toEqual({});
  });

  it("normalizes @-prefixed and mixed-case domains", () => {
    expect(parseRuleConditions('{"emailDomains":["@Example.COM","Foo.Org"]}').emailDomains).toEqual(["example.com", "foo.org"]);
  });

  it("drops non-numeric numbers and empty arrays", () => {
    const parsed = parseRuleConditions('{"maxDaysLeft":"7","minScore":null,"minDaysOverdue":true,"teamIds":[],"courseIds":["",  "  "]}');
    expect(parsed.maxDaysLeft).toBeUndefined();
    expect(parsed.minScore).toBeUndefined();
    expect(parsed.minDaysOverdue).toBeUndefined();
    expect(parsed.teamIds).toBeUndefined();
    expect(parsed.courseIds).toBeUndefined();
  });

  it("keeps valid values", () => {
    const parsed = parseRuleConditions('{"teamIds":["t1"],"maxDaysLeft":7,"maxDaysToExpiry":-2,"minScore":0}');
    expect(parsed.teamIds).toEqual(["t1"]);
    expect(parsed.maxDaysLeft).toBe(7);
    expect(parsed.maxDaysToExpiry).toBe(-2);
    expect(parsed.minScore).toBe(0);
  });
});

describe("coerceRuleAction / parseRuleActions", () => {
  it("round-trips all four valid action types", () => {
    expect(coerceRuleAction({ type: "assign_course", courseId: "c1", courseName: "Sec", dueInDays: 14 })).toEqual({
      type: "assign_course",
      courseId: "c1",
      courseName: "Sec",
      dueInDays: 14,
    });
    expect(coerceRuleAction({ type: "add_to_team", teamId: "t1", teamName: "Eng" })).toEqual({ type: "add_to_team", teamId: "t1", teamName: "Eng" });
    expect(coerceRuleAction({ type: "notify", channel: "slack", target: "#sec", message: "hi" })).toEqual({
      type: "notify",
      channel: "slack",
      target: "#sec",
      message: "hi",
    });
    expect(coerceRuleAction({ type: "notify_learner", message: "hi" })).toEqual({ type: "notify_learner", message: "hi" });
  });

  it("rejects unknown types, missing required fields, and bad channels", () => {
    expect(coerceRuleAction({ type: "explode" })).toBeNull();
    expect(coerceRuleAction(null)).toBeNull();
    expect(coerceRuleAction("assign_course")).toBeNull();
    expect(coerceRuleAction({ type: "assign_course" })).toBeNull();
    expect(coerceRuleAction({ type: "assign_course", courseId: "  " })).toBeNull();
    expect(coerceRuleAction({ type: "add_to_team" })).toBeNull();
    expect(coerceRuleAction({ type: "notify" })).toBeNull();
    expect(coerceRuleAction({ type: "notify", channel: "pigeon" })).toBeNull();
  });

  it("parseRuleActions returns [] for non-array JSON and filters invalid entries", () => {
    expect(parseRuleActions(null)).toEqual([]);
    expect(parseRuleActions("garbage")).toEqual([]);
    expect(parseRuleActions('{"type":"notify_learner"}')).toEqual([]);
    expect(parseRuleActions("null")).toEqual([]);
    expect(parseRuleActions('[{"type":"notify_learner"},{"type":"bogus"},{"type":"notify","channel":"email"}]')).toEqual([
      { type: "notify_learner" },
      { type: "notify", channel: "email" },
    ]);
  });
});

describe("eventDedupeKey", () => {
  it("orders trigger:email:course:assignment and lowercases the email", () => {
    const key = eventDedupeKey(event({ learner: { email: "Alice@Corp.COM" } }));
    expect(key).toBe("assignment.completed:alice@corp.com:c1:a1");
  });

  it("uses '-' placeholders for missing parts", () => {
    expect(eventDedupeKey({ trigger: "schedule.daily" })).toBe("schedule.daily:-:-:-");
  });

  it("appends cycleKey only when present", () => {
    expect(eventDedupeKey(event({ cycleKey: "2026-07-03" }))).toBe("assignment.completed:alice@corp.com:c1:a1:2026-07-03");
    expect(eventDedupeKey(event())).toBe("assignment.completed:alice@corp.com:c1:a1");
  });
});

describe("renderTemplate", () => {
  it("substitutes string and number vars", () => {
    expect(renderTemplate("Hi {{name}}, {{days}} day(s) left", { name: "Ada", days: 3 })).toBe("Hi Ada, 3 day(s) left");
  });

  it("renders unknown keys and null/undefined as empty string", () => {
    expect(renderTemplate("a{{missing}}b", {})).toBe("ab");
    expect(renderTemplate("a{{x}}b{{y}}c", { x: null, y: undefined })).toBe("abc");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ name }}!", { name: "Ada" })).toBe("Hi Ada!");
  });
});

describe("parseReminderDays", () => {
  it("falls back to the default cadence for null, empty array, and garbage", () => {
    expect(parseReminderDays(null)).toEqual(DEFAULT_REMINDER_DAYS);
    expect(parseReminderDays(undefined)).toEqual(DEFAULT_REMINDER_DAYS);
    expect(parseReminderDays("[]")).toEqual(DEFAULT_REMINDER_DAYS);
    expect(parseReminderDays("garbage")).toEqual(DEFAULT_REMINDER_DAYS);
    expect(parseReminderDays('{"days":[7]}')).toEqual(DEFAULT_REMINDER_DAYS);
  });

  it("dedupes, drops out-of-range/non-integer entries, and sorts descending", () => {
    expect(parseReminderDays('[7,1,7,400,-2,"x"]')).toEqual([7, 1]);
    expect(parseReminderDays("[1,3,14,7]")).toEqual([14, 7, 3, 1]);
  });
});

describe("daysUntil / reminderBucket", () => {
  const NOW = 1_750_000_000_000;

  it("daysUntil ceils to whole days and goes negative past due", () => {
    expect(daysUntil(NOW + 7 * DAY_MS, NOW)).toBe(7);
    expect(daysUntil(NOW + 1, NOW)).toBe(1);
    expect(daysUntil(NOW - DAY_MS, NOW)).toBe(-1);
  });

  it("due in exactly 7 days with cadence [14,7,3,1] picks bucket 7", () => {
    expect(reminderBucket(NOW + 7 * DAY_MS, NOW, [14, 7, 3, 1])).toBe(7);
  });

  it("just past the 7-day window falls back to the 14 bucket", () => {
    expect(reminderBucket(NOW + 7 * DAY_MS + 1, NOW, [14, 7, 3, 1])).toBe(14);
  });

  it("beyond the largest window returns null", () => {
    expect(reminderBucket(NOW + 15 * DAY_MS, NOW, [14, 7, 3, 1])).toBeNull();
  });

  it("past due (or due right now) returns null", () => {
    expect(reminderBucket(NOW, NOW, [14, 7, 3, 1])).toBeNull();
    expect(reminderBucket(NOW - DAY_MS, NOW, [14, 7, 3, 1])).toBeNull();
  });

  it("crossing buckets always picks the smallest eligible window", () => {
    expect(reminderBucket(NOW + 3 * DAY_MS, NOW, [14, 7, 3, 1])).toBe(3);
    expect(reminderBucket(NOW + 2 * DAY_MS, NOW, [14, 7, 3, 1])).toBe(3);
    expect(reminderBucket(NOW + 1 * DAY_MS, NOW, [14, 7, 3, 1])).toBe(1);
  });
});

describe("complianceStatus / complianceExpiry", () => {
  const COMPLETED = 1_700_000_000_000;
  const RENEWAL_MONTHS = 12;
  const WARN_DAYS = 30;
  const EXPIRES = complianceExpiry(COMPLETED, RENEWAL_MONTHS);

  it("never when there is no completion", () => {
    expect(complianceStatus(null, RENEWAL_MONTHS, WARN_DAYS, COMPLETED)).toBe("never");
    expect(complianceStatus(undefined, RENEWAL_MONTHS, WARN_DAYS, COMPLETED)).toBe("never");
  });

  it("compliant while outside the warn window", () => {
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, EXPIRES - WARN_DAYS * DAY_MS - 1)).toBe("compliant");
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, COMPLETED + DAY_MS)).toBe("compliant");
  });

  it("expiring exactly at the warnDays boundary", () => {
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, EXPIRES - WARN_DAYS * DAY_MS)).toBe("expiring");
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, EXPIRES - 1)).toBe("expiring");
  });

  it("expired exactly at the expiry boundary", () => {
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, EXPIRES)).toBe("expired");
    expect(complianceStatus(COMPLETED, RENEWAL_MONTHS, WARN_DAYS, EXPIRES + DAY_MS)).toBe("expired");
  });
});

describe("toCsv", () => {
  it("joins with CRLF and ends with a trailing CRLF", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes cells containing commas, quotes, and newlines", () => {
    expect(toCsv(["h"], [["hello, world"]])).toBe('h\r\n"hello, world"\r\n');
    expect(toCsv(["h"], [['say "hi"']])).toBe('h\r\n"say ""hi"""\r\n');
    expect(toCsv(["h"], [["line1\nline2"]])).toBe('h\r\n"line1\nline2"\r\n');
  });

  it("guards formula-injection prefixes with a leading apostrophe", () => {
    expect(toCsv(["h"], [["=SUM(A1)"]])).toBe("h\r\n'=SUM(A1)\r\n");
    expect(toCsv(["h"], [["+1"]])).toBe("h\r\n'+1\r\n");
    expect(toCsv(["h"], [["-cmd"]])).toBe("h\r\n'-cmd\r\n");
    expect(toCsv(["h"], [["@import"]])).toBe("h\r\n'@import\r\n");
    expect(toCsv(["h"], [["\tx"]])).toBe("h\r\n'\tx\r\n");
    // Guarded value that also needs quoting stays quoted.
    expect(toCsv(["h"], [["=1,2"]])).toBe('h\r\n"\'=1,2"\r\n');
  });

  it("renders null/undefined as empty cells and numbers as plain text", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, 42]])).toBe("a,b,c\r\n,,42\r\n");
  });
});

describe("course art", () => {
  it("courseHue is deterministic and within 0..359", () => {
    expect(courseHue("abc")).toBe(courseHue("abc"));
    for (const seed of ["", "abc", "Security 101", "zzz"]) {
      const hue = courseHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it("courseGradient is deterministic hsl pairs for the same seed", () => {
    const g1 = courseGradient("Security 101");
    const g2 = courseGradient("Security 101");
    expect(g1).toEqual(g2);
    expect(g1.from).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(g1.to).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(g1.from).not.toBe(g1.to);
  });

  it("courseInitials handles 1-word, 2-word, and empty names", () => {
    expect(courseInitials("Security")).toBe("SE");
    expect(courseInitials("phishing basics")).toBe("PB");
    expect(courseInitials("Advanced Threat Modeling 2026")).toBe("AT");
    expect(courseInitials("")).toBe("?");
    expect(courseInitials("   ")).toBe("?");
  });
});

describe("assignmentBadgeTone", () => {
  it("maps statuses to badge tones", () => {
    expect(assignmentBadgeTone("completed")).toBe("low");
    expect(assignmentBadgeTone("overdue")).toBe("high");
    expect(assignmentBadgeTone("failed")).toBe("high");
    expect(assignmentBadgeTone("cancelled")).toBe("none");
    expect(assignmentBadgeTone("pending")).toBe("medium");
    expect(assignmentBadgeTone("scheduled")).toBe("medium");
    expect(assignmentBadgeTone("active")).toBe("medium");
  });
});

describe("OPEN_ASSIGNMENT_STATUSES", () => {
  it("contains exactly the four open statuses", () => {
    expect([...OPEN_ASSIGNMENT_STATUSES].sort()).toEqual(["active", "overdue", "pending", "scheduled"]);
    expect(OPEN_ASSIGNMENT_STATUSES).not.toContain("completed");
    expect(OPEN_ASSIGNMENT_STATUSES).not.toContain("failed");
    expect(OPEN_ASSIGNMENT_STATUSES).not.toContain("cancelled");
  });
});
