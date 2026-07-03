// LMS domain types + pure logic. Client-importable (no db/crypto imports) so the
// rule-builder UI shares the exact types the server evaluates, mirroring the
// studio/types.ts pattern. Everything here is deterministic and unit-tested.

// ─── rules engine ─────────────────────────────────────────────────────────────

export type RuleTrigger =
  | "learner.created"
  | "learner.team_joined"
  | "assignment.completed"
  | "assignment.due_soon"
  | "assignment.overdue"
  | "compliance.expiring"
  | "schedule.daily";

export const RULE_TRIGGERS: Array<{ value: RuleTrigger; label: string; hint: string }> = [
  { value: "learner.created", label: "Learner created", hint: "A new learner appears (created here or synced from Litmos)." },
  { value: "learner.team_joined", label: "Learner joined a team", hint: "A learner is added to a Litmos team." },
  { value: "assignment.completed", label: "Course completed", hint: "A learner completes an assigned course." },
  { value: "assignment.due_soon", label: "Assignment due soon", hint: "An open assignment enters a reminder window before its due date." },
  { value: "assignment.overdue", label: "Assignment overdue", hint: "An open assignment passes its due date." },
  { value: "compliance.expiring", label: "Compliance expiring", hint: "A learner's compliance credit enters its warning window or lapses." },
  { value: "schedule.daily", label: "Daily schedule", hint: "Fires once per learner per day on the scheduler tick (use conditions to scope)." },
];

export type NotifyChannelId = "slack" | "teams" | "googlechat" | "email";
export const NOTIFY_CHANNELS: NotifyChannelId[] = ["slack", "teams", "googlechat", "email"];

export interface RuleConditions {
  /** Learner must belong to at least one of these Litmos team ids. */
  teamIds?: string[];
  /** Learner email domain must be one of these (no @). */
  emailDomains?: string[];
  /** Event course must be one of these Litmos course ids. */
  courseIds?: string[];
  /** due_soon: fire when days until due <= this. */
  maxDaysLeft?: number;
  /** overdue: fire when days past due >= this. */
  minDaysOverdue?: number;
  /** compliance.expiring: fire when days until expiry <= this (negative = already lapsed). */
  maxDaysToExpiry?: number;
  /** completed: score bounds (inclusive). */
  minScore?: number;
  maxScore?: number;
}

export type RuleAction =
  | { type: "assign_course"; courseId: string; courseName?: string; dueInDays?: number }
  | { type: "add_to_team"; teamId: string; teamName?: string }
  | { type: "notify"; channel: NotifyChannelId; target?: string; message?: string }
  | { type: "notify_learner"; message?: string };

export const RULE_ACTION_TYPES = ["assign_course", "add_to_team", "notify", "notify_learner"] as const;

export interface LmsEvent {
  trigger: RuleTrigger;
  learner?: { email: string; name?: string | null; litmosUserId?: string | null; teamIds?: string[] };
  course?: { litmosId: string; name?: string | null };
  assignment?: { id: string; dueDate?: number | null; score?: number | null };
  /** due_soon: whole days until the due date (>= 0). */
  daysLeft?: number;
  /** overdue: whole days past the due date (>= 1). */
  daysOverdue?: number;
  /** compliance.expiring: whole days until expiry (negative once lapsed). */
  daysToExpiry?: number;
  /** Extra dedupe discriminator (e.g. compliance cycle expiry timestamp, daily date). */
  cycleKey?: string;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return out.length ? out : undefined;
}

// Tolerant parse gates (the coerceBlock pattern): persisted JSON and form input
// both pass through these, so malformed rows degrade to "no conditions"/"no
// actions" instead of throwing at evaluation time.
export function parseRuleConditions(raw: string | null | undefined): RuleConditions {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return {};
    return {
      teamIds: strArray(obj.teamIds),
      emailDomains: strArray(obj.emailDomains)?.map((d) => d.replace(/^@/, "").toLowerCase()),
      courseIds: strArray(obj.courseIds),
      maxDaysLeft: num(obj.maxDaysLeft),
      minDaysOverdue: num(obj.minDaysOverdue),
      maxDaysToExpiry: num(obj.maxDaysToExpiry),
      minScore: num(obj.minScore),
      maxScore: num(obj.maxScore),
    };
  } catch {
    return {};
  }
}

export function coerceRuleAction(raw: unknown): RuleAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  switch (a.type) {
    case "assign_course": {
      const courseId = s(a.courseId);
      if (!courseId) return null;
      return { type: "assign_course", courseId, courseName: s(a.courseName), dueInDays: num(a.dueInDays) };
    }
    case "add_to_team": {
      const teamId = s(a.teamId);
      if (!teamId) return null;
      return { type: "add_to_team", teamId, teamName: s(a.teamName) };
    }
    case "notify": {
      const channel = s(a.channel) as NotifyChannelId | undefined;
      if (!channel || !NOTIFY_CHANNELS.includes(channel)) return null;
      return { type: "notify", channel, target: s(a.target), message: s(a.message) };
    }
    case "notify_learner":
      return { type: "notify_learner", message: s(a.message) };
    default:
      return null;
  }
}

export function parseRuleActions(raw: string | null | undefined): RuleAction[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(coerceRuleAction).filter((a): a is RuleAction => a !== null);
  } catch {
    return [];
  }
}

export function ruleMatches(conditions: RuleConditions, event: LmsEvent): boolean {
  const c = conditions;
  if (c.teamIds?.length) {
    const teams = event.learner?.teamIds ?? [];
    if (!c.teamIds.some((t) => teams.includes(t))) return false;
  }
  if (c.emailDomains?.length) {
    const email = event.learner?.email?.toLowerCase() ?? "";
    const domain = email.split("@")[1] ?? "";
    if (!c.emailDomains.includes(domain)) return false;
  }
  if (c.courseIds?.length) {
    if (!event.course || !c.courseIds.includes(event.course.litmosId)) return false;
  }
  if (c.maxDaysLeft !== undefined) {
    if (event.daysLeft === undefined || event.daysLeft > c.maxDaysLeft) return false;
  }
  if (c.minDaysOverdue !== undefined) {
    if (event.daysOverdue === undefined || event.daysOverdue < c.minDaysOverdue) return false;
  }
  if (c.maxDaysToExpiry !== undefined) {
    if (event.daysToExpiry === undefined || event.daysToExpiry > c.maxDaysToExpiry) return false;
  }
  if (c.minScore !== undefined) {
    const score = event.assignment?.score;
    if (score === undefined || score === null || score < c.minScore) return false;
  }
  if (c.maxScore !== undefined) {
    const score = event.assignment?.score;
    if (score === undefined || score === null || score > c.maxScore) return false;
  }
  return true;
}

// One firing per (rule, subject, cycle). due_soon deliberately omits the day
// count so a learner gets at most one due-soon firing per assignment per rule —
// reminder cadence is the notification engine's job, not the rules engine's.
export function eventDedupeKey(event: LmsEvent): string {
  const parts: string[] = [event.trigger, event.learner?.email?.toLowerCase() ?? "-", event.course?.litmosId ?? "-", event.assignment?.id ?? "-"];
  if (event.cycleKey) parts.push(event.cycleKey);
  return parts.join(":");
}

// ─── notification templates ───────────────────────────────────────────────────

export const TEMPLATE_KEYS = ["assignment_created", "due_soon", "overdue", "completed", "compliance_expiring"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATES: Record<TemplateKey, { label: string; subject: string; body: string }> = {
  assignment_created: {
    label: "Assignment created",
    subject: "New training assigned: {{course}}",
    body: "{{learner}}, you have been assigned \"{{course}}\"{{dueClause}}. Log in to Litmos to complete it.",
  },
  due_soon: {
    label: "Due-date reminder",
    subject: "Training due in {{daysLeft}} day(s): {{course}}",
    body: "{{learner}}, your training \"{{course}}\" is due on {{dueDate}} ({{daysLeft}} day(s) left).",
  },
  overdue: {
    label: "Overdue notice",
    subject: "Training overdue: {{course}}",
    body: "{{learner}}, your training \"{{course}}\" was due on {{dueDate}} and is now {{daysOverdue}} day(s) overdue.",
  },
  completed: {
    label: "Completion confirmation",
    subject: "Training completed: {{course}}",
    body: "{{learner}} completed \"{{course}}\"{{scoreClause}}.",
  },
  compliance_expiring: {
    label: "Compliance expiring",
    subject: "Compliance expiring: {{course}}",
    body: "{{learner}}'s compliance credit for \"{{course}}\" expires on {{expiresDate}} ({{daysToExpiry}} day(s) left).",
  },
};

// {{key}} substitution; unknown keys render as empty string so a template typo
// never leaks braces into an outbound message.
export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

// ─── reminder cadence ─────────────────────────────────────────────────────────

export const DEFAULT_REMINDER_DAYS = [14, 7, 3, 1];
const DAY_MS = 86_400_000;

export function parseReminderDays(raw: string | null | undefined): number[] {
  if (!raw) return DEFAULT_REMINDER_DAYS;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_REMINDER_DAYS;
    const days = [...new Set(arr.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 365))];
    return days.length ? days.sort((a, b) => b - a) : DEFAULT_REMINDER_DAYS;
  } catch {
    return DEFAULT_REMINDER_DAYS;
  }
}

/** Whole days until due (ceil), negative once past due. */
export function daysUntil(ts: number, now: number): number {
  return Math.ceil((ts - now) / DAY_MS);
}

// Which cadence bucket applies right now: the smallest configured day >= days
// left. Each bucket fires once (deduped by the reminder ledger); crossing into a
// smaller bucket fires again. null when not yet in any window or already due.
export function reminderBucket(dueDate: number, now: number, cadence: number[]): number | null {
  const left = daysUntil(dueDate, now);
  if (left <= 0) return null;
  const eligible = cadence.filter((d) => left <= d);
  if (!eligible.length) return null;
  return Math.min(...eligible);
}

// ─── compliance ───────────────────────────────────────────────────────────────

export type ComplianceStatus = "never" | "compliant" | "expiring" | "expired";
const MONTH_MS = 30.44 * DAY_MS; // mean month; compliance windows are month-granular

export function complianceExpiry(lastCompletedAt: number, renewalMonths: number): number {
  return Math.round(lastCompletedAt + renewalMonths * MONTH_MS);
}

export function complianceStatus(lastCompletedAt: number | null | undefined, renewalMonths: number, warnDays: number, now: number): ComplianceStatus {
  if (!lastCompletedAt) return "never";
  const expires = complianceExpiry(lastCompletedAt, renewalMonths);
  if (expires <= now) return "expired";
  if (expires - now <= warnDays * DAY_MS) return "expiring";
  return "compliant";
}

// ─── assignment status ────────────────────────────────────────────────────────

export type AssignmentStatus = "pending" | "scheduled" | "active" | "completed" | "overdue" | "failed" | "cancelled";
export const OPEN_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["pending", "scheduled", "active", "overdue"];

export function assignmentBadgeTone(status: string): string {
  if (status === "completed") return "low";
  if (status === "overdue" || status === "failed") return "high";
  if (status === "cancelled") return "none";
  return "medium";
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote when needed; prefix formula triggers so a malicious course/learner
  // name can't become an executing formula when opened in Excel.
  const guarded = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ─── course art (Netflix-style card gradients, deterministic per course) ─────

export function courseHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function courseGradient(seed: string): { from: string; to: string } {
  const hue = courseHue(seed);
  const hue2 = (hue + 40) % 360;
  return { from: `hsl(${hue} 65% 30%)`, to: `hsl(${hue2} 70% 16%)` };
}

export function courseInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
