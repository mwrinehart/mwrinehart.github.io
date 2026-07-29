// Team reporting: the aggregate views a team admin needs (overview metrics,
// per-course status, compliance standing) plus CSV export. Per-learner course
// reads fan out with bounded concurrency and a user cap, mirroring the scale
// guards Content Studio's Litmos reporting uses, so a big team can't melt the
// ~100 req/min Litmos rate limit.

import type { LitmosSource } from "./source";
import type { LitmosCourseUserStatus, LitmosUser, LitmosUserCourse } from "./types";

const DAY = 86_400_000;
export const REPORT_USER_CAP = 200;
const CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── member progress (the workhorse dataset) ──────────────────────────────────

export interface MemberProgress {
  user: LitmosUser;
  teamIds: string[];
  courses: LitmosUserCourse[];
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  // compliance
  expiringSoon: number; // compliant-until within 30 days
  lapsed: number; // compliant-until in the past
  capped?: boolean;
}

export interface TeamProgressData {
  members: MemberProgress[];
  capped: boolean;
}

export function summarizeCourses(courses: LitmosUserCourse[], now = Date.now()): Omit<MemberProgress, "user" | "teamIds" | "courses"> {
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  let overdue = 0;
  let expiringSoon = 0;
  let lapsed = 0;
  for (const c of courses) {
    if (c.Complete) completed++;
    else if (c.PercentageComplete > 0) inProgress++;
    else notStarted++;
    if (!c.Complete && c.Overdue) overdue++;
    if (c.ComplaintTill) {
      const till = Date.parse(c.ComplaintTill);
      if (!Number.isNaN(till)) {
        if (till < now) lapsed++;
        else if (till - now < 30 * DAY) expiringSoon++;
      }
    }
  }
  return { completed, inProgress, notStarted, overdue, expiringSoon, lapsed };
}

// Distinct members across the scoped teams, each with their course list.
export async function gatherTeamProgress(source: LitmosSource, teamIds: string[]): Promise<TeamProgressData> {
  const byUser = new Map<string, { user: LitmosUser; teamIds: string[] }>();
  for (const teamId of teamIds) {
    let users: LitmosUser[];
    try {
      users = await source.listTeamUsers(teamId);
    } catch {
      continue;
    }
    for (const user of users) {
      const existing = byUser.get(user.Id);
      if (existing) existing.teamIds.push(teamId);
      else byUser.set(user.Id, { user, teamIds: [teamId] });
    }
  }

  const all = [...byUser.values()];
  const capped = all.length > REPORT_USER_CAP;
  const sliced = capped ? all.slice(0, REPORT_USER_CAP) : all;

  const members = await mapLimit(sliced, CONCURRENCY, async ({ user, teamIds: memberTeamIds }) => {
    let courses: LitmosUserCourse[] = [];
    try {
      courses = await source.listUserCourses(user.Id);
    } catch {
      courses = [];
    }
    return { user, teamIds: memberTeamIds, courses, ...summarizeCourses(courses) };
  });
  return { members, capped };
}

// ─── overview metrics ─────────────────────────────────────────────────────────

export interface OverviewMetrics {
  members: number;
  assignments: number;
  completed: number;
  completionRate: number; // 0-100
  overdue: number;
  overdueMembers: number;
  expiringSoon: number;
  lapsed: number;
  capped: boolean;
}

export function computeOverview(data: TeamProgressData): OverviewMetrics {
  let assignments = 0;
  let completed = 0;
  let overdue = 0;
  let overdueMembers = 0;
  let expiringSoon = 0;
  let lapsed = 0;
  for (const m of data.members) {
    assignments += m.courses.length;
    completed += m.completed;
    overdue += m.overdue;
    if (m.overdue > 0) overdueMembers++;
    expiringSoon += m.expiringSoon;
    lapsed += m.lapsed;
  }
  return {
    members: data.members.length,
    assignments,
    completed,
    completionRate: assignments ? Math.round((completed / assignments) * 100) : 0,
    overdue,
    overdueMembers,
    expiringSoon,
    lapsed,
    capped: data.capped,
  };
}

// ─── per-course status (due dates & compliance pages) ─────────────────────────

export interface CourseStatusSummary {
  courseId: string;
  users: LitmosCourseUserStatus[];
  completed: number;
  overdue: number;
  dueSoon: number; // due within 7 days
  expiringSoon: number;
  lapsed: number;
}

export function summarizeCourseUsers(courseId: string, users: LitmosCourseUserStatus[], now = Date.now()): CourseStatusSummary {
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  let expiringSoon = 0;
  let lapsed = 0;
  for (const u of users) {
    if (u.Completed) completed++;
    if (u.DueDate && !u.Completed) {
      const due = Date.parse(u.DueDate);
      if (!Number.isNaN(due)) {
        if (due < now) overdue++;
        else if (due - now < 7 * DAY) dueSoon++;
      }
    }
    if (u.CompliantTill) {
      const till = Date.parse(u.CompliantTill);
      if (!Number.isNaN(till)) {
        if (till < now) lapsed++;
        else if (till - now < 30 * DAY) expiringSoon++;
      }
    }
  }
  return { courseId, users, completed, overdue, dueSoon, expiringSoon, lapsed };
}

// Course-user rows filtered to the scoped members only (the endpoint returns
// EVERY assigned user in the account — a team admin must never see beyond
// their teams).
export async function courseStatusForTeams(
  source: LitmosSource,
  courseId: string,
  scopeMemberIds: Set<string>,
): Promise<CourseStatusSummary> {
  const all = await source.listCourseUsers(courseId);
  const scoped = all.filter((u) => scopeMemberIds.has(u.Id));
  return summarizeCourseUsers(courseId, scoped);
}

export async function scopedMemberIds(source: LitmosSource, teamIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const teamId of teamIds) {
    try {
      for (const u of await source.listTeamUsers(teamId)) ids.add(u.Id);
    } catch {
      // team may have been deleted; skip
    }
  }
  return ids;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export function toCsv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; header: string }>): string {
  const escape = (v: unknown): string => {
    let s = v == null ? "" : String(v);
    // Neutralize spreadsheet formula injection: a cell a lower-privileged team
    // admin can influence (a member's name/email) must not execute as a formula
    // when an owner opens the export in Excel/Sheets. Prefix a leading
    // =/+/-/@/tab/CR with an apostrophe so the cell is treated as text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c.key])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function memberProgressCsv(data: TeamProgressData): string {
  return toCsv(
    data.members.map((m) => ({
      name: `${m.user.FirstName} ${m.user.LastName}`,
      email: m.user.Email,
      active: m.user.Active ? "yes" : "no",
      assigned: m.courses.length,
      completed: m.completed,
      in_progress: m.inProgress,
      not_started: m.notStarted,
      overdue: m.overdue,
      compliance_expiring_30d: m.expiringSoon,
      compliance_lapsed: m.lapsed,
    })),
    [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "active", header: "Active" },
      { key: "assigned", header: "Assigned courses" },
      { key: "completed", header: "Completed" },
      { key: "in_progress", header: "In progress" },
      { key: "not_started", header: "Not started" },
      { key: "overdue", header: "Overdue" },
      { key: "compliance_expiring_30d", header: "Compliance expiring (30d)" },
      { key: "compliance_lapsed", header: "Compliance lapsed" },
    ],
  );
}

export function assignmentDetailCsv(data: TeamProgressData): string {
  const rows: Array<Record<string, unknown>> = [];
  for (const m of data.members) {
    for (const c of m.courses) {
      rows.push({
        name: `${m.user.FirstName} ${m.user.LastName}`,
        email: m.user.Email,
        course: c.Name,
        status: c.Complete ? "completed" : c.PercentageComplete > 0 ? "in progress" : "not started",
        percent: c.PercentageComplete,
        assigned: c.AssignedDate ?? "",
        completed: c.CompletedDate ?? "",
        overdue: !c.Complete && c.Overdue ? "yes" : "no",
        compliant_till: c.ComplaintTill ?? "",
      });
    }
  }
  return toCsv(rows, [
    { key: "name", header: "Name" },
    { key: "email", header: "Email" },
    { key: "course", header: "Course" },
    { key: "status", header: "Status" },
    { key: "percent", header: "% complete" },
    { key: "assigned", header: "Assigned" },
    { key: "completed", header: "Completed" },
    { key: "overdue", header: "Overdue" },
    { key: "compliant_till", header: "Compliant until" },
  ]);
}
