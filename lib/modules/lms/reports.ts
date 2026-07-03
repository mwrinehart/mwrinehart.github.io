// LMS reporting: aggregate rollups over the assignment/compliance mirror plus
// the pure risk-vs-training correlation used by the cross-module report. All
// rollups use grouped count queries so report pages stay fast on large orgs.

import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { OPEN_ASSIGNMENT_STATUSES } from "./types";
import { lmsAssignments, lmsComplianceRecords, lmsCourses, lmsLearners, lmsTeamMembers, lmsTeams } from "./schema";

const DAY_MS = 86_400_000;

// ─── overview ─────────────────────────────────────────────────────────────────

export async function lmsOverview(
  orgId: string,
): Promise<{ learners: number; courses: number; openAssignments: number; overdue: number; complianceRate: number | null }> {
  const [[learners], [courses], [assign], [comp]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(lmsLearners)
      .where(and(eq(lmsLearners.orgId, orgId), eq(lmsLearners.active, true))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(lmsCourses)
      .where(and(eq(lmsCourses.orgId, orgId), eq(lmsCourses.active, true))),
    db
      .select({
        open: sql<number>`(count(*) filter (where ${inArray(lmsAssignments.status, OPEN_ASSIGNMENT_STATUSES)}))::int`,
        overdue: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'overdue'))::int`,
      })
      .from(lmsAssignments)
      .where(eq(lmsAssignments.orgId, orgId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        ok: sql<number>`(count(*) filter (where ${inArray(lmsComplianceRecords.status, ["compliant", "expiring"])}))::int`,
      })
      .from(lmsComplianceRecords)
      .where(eq(lmsComplianceRecords.orgId, orgId)),
  ]);
  return {
    learners: learners.n,
    courses: courses.n,
    openAssignments: assign.open,
    overdue: assign.overdue,
    complianceRate: comp.total ? Math.round((comp.ok / comp.total) * 100) : null,
  };
}

// ─── completion rollups ───────────────────────────────────────────────────────

function rate(completed: number, assigned: number): number {
  return assigned ? Math.round((completed / assigned) * 100) : 0;
}

export async function completionByCourse(
  orgId: string,
): Promise<Array<{ courseId: string; courseName: string; assigned: number; completed: number; overdue: number; completionRate: number }>> {
  const rows = await db
    .select({
      courseId: lmsAssignments.courseLitmosId,
      courseName: lmsAssignments.courseName,
      assigned: sql<number>`count(*)::int`,
      completed: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'completed'))::int`,
      overdue: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'overdue'))::int`,
    })
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.orgId, orgId), ne(lmsAssignments.status, "cancelled")))
    .groupBy(lmsAssignments.courseLitmosId, lmsAssignments.courseName)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({
    courseId: r.courseId,
    courseName: r.courseName || r.courseId,
    assigned: r.assigned,
    completed: r.completed,
    overdue: r.overdue,
    completionRate: rate(r.completed, r.assigned),
  }));
}

// Per-learner assignment rollup (grouped by lowercased email), shared by the
// team rollup and the risk correlation.
function assignmentStatsByEmail(orgId: string) {
  return db
    .select({
      email: sql<string>`lower(${lmsAssignments.learnerEmail})`,
      name: sql<string | null>`max(${lmsAssignments.learnerName})`,
      assigned: sql<number>`count(*)::int`,
      completed: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'completed'))::int`,
      open: sql<number>`(count(*) filter (where ${inArray(lmsAssignments.status, OPEN_ASSIGNMENT_STATUSES)}))::int`,
      overdue: sql<number>`(count(*) filter (where ${lmsAssignments.status} = 'overdue'))::int`,
    })
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.orgId, orgId), ne(lmsAssignments.status, "cancelled")))
    .groupBy(sql`lower(${lmsAssignments.learnerEmail})`);
}

export async function completionByTeam(
  orgId: string,
): Promise<Array<{ teamId: string; teamName: string; learners: number; assigned: number; completed: number; overdue: number; completionRate: number }>> {
  const [teams, members, learners, stats] = await Promise.all([
    db.select({ litmosId: lmsTeams.litmosId, name: lmsTeams.name }).from(lmsTeams).where(eq(lmsTeams.orgId, orgId)),
    db
      .select({ teamId: lmsTeamMembers.teamLitmosId, learnerId: lmsTeamMembers.learnerLitmosId })
      .from(lmsTeamMembers)
      .where(eq(lmsTeamMembers.orgId, orgId)),
    db.select({ litmosId: lmsLearners.litmosId, email: lmsLearners.email }).from(lmsLearners).where(eq(lmsLearners.orgId, orgId)),
    assignmentStatsByEmail(orgId),
  ]);

  const emailByLearner = new Map(learners.map((l) => [l.litmosId, (l.email ?? "").toLowerCase()]));
  const statByEmail = new Map(stats.map((s) => [s.email, s]));
  const membersByTeam = new Map<string, string[]>();
  for (const m of members) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push(m.learnerId);
    membersByTeam.set(m.teamId, list);
  }

  return teams
    .map((t) => {
      const teamMembers = membersByTeam.get(t.litmosId) ?? [];
      let assigned = 0;
      let completed = 0;
      let overdue = 0;
      for (const learnerId of teamMembers) {
        const stat = statByEmail.get(emailByLearner.get(learnerId) ?? "");
        if (!stat) continue;
        assigned += stat.assigned;
        completed += stat.completed;
        overdue += stat.overdue;
      }
      return {
        teamId: t.litmosId,
        teamName: t.name || t.litmosId,
        learners: teamMembers.length,
        assigned,
        completed,
        overdue,
        completionRate: rate(completed, assigned),
      };
    })
    .sort((a, b) => b.assigned - a.assigned);
}

// ─── overdue aging ────────────────────────────────────────────────────────────

const AGING_BUCKETS = ["1–7d", "8–30d", "31–90d", "90d+"] as const;

export async function overdueAging(orgId: string, now: number = Date.now()): Promise<Array<{ label: string; count: number }>> {
  const rows = await db
    .select({ dueDate: lmsAssignments.dueDate })
    .from(lmsAssignments)
    .where(and(eq(lmsAssignments.orgId, orgId), eq(lmsAssignments.status, "overdue"), isNotNull(lmsAssignments.dueDate)));

  const counts = [0, 0, 0, 0];
  for (const r of rows) {
    if (r.dueDate === null) continue;
    const days = Math.max(1, Math.ceil((now - r.dueDate) / DAY_MS));
    if (days <= 7) counts[0]++;
    else if (days <= 30) counts[1]++;
    else if (days <= 90) counts[2]++;
    else counts[3]++;
  }
  return AGING_BUCKETS.map((label, i) => ({ label, count: counts[i] }));
}

// ─── monthly trend ────────────────────────────────────────────────────────────

function utcMonthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

export async function monthlyTrend(orgId: string, months = 6): Promise<Array<{ month: string; assigned: number; completed: number }>> {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1);
  const [assignedRows, completedRows] = await Promise.all([
    db
      .select({ ts: lmsAssignments.assignedAt })
      .from(lmsAssignments)
      .where(and(eq(lmsAssignments.orgId, orgId), gte(lmsAssignments.assignedAt, start))),
    db
      .select({ ts: lmsAssignments.completedAt })
      .from(lmsAssignments)
      .where(and(eq(lmsAssignments.orgId, orgId), gte(lmsAssignments.completedAt, start))),
  ]);

  const buckets = new Map<string, { assigned: number; completed: number }>();
  for (let i = months - 1; i >= 0; i--) {
    buckets.set(utcMonthKey(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)), { assigned: 0, completed: 0 });
  }
  for (const r of assignedRows) {
    const b = buckets.get(utcMonthKey(r.ts));
    if (b) b.assigned++;
  }
  for (const r of completedRows) {
    if (r.ts === null) continue;
    const b = buckets.get(utcMonthKey(r.ts));
    if (b) b.completed++;
  }
  return [...buckets.entries()].map(([month, v]) => ({ month, assigned: v.assigned, completed: v.completed }));
}

// ─── risk × training correlation ─────────────────────────────────────────────

export async function trainingStatsByEmail(
  orgId: string,
): Promise<Array<{ email: string; name: string | null; completed: number; open: number; overdue: number }>> {
  const rows = await assignmentStatsByEmail(orgId);
  return rows
    .map((r) => ({ email: r.email, name: r.name, completed: r.completed, open: r.open, overdue: r.overdue }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

// Pure join of behavior risk scores against training stats. Training rows with
// no risk record are dropped (no score to band on); risk rows with no training
// history keep zeros so untrained high-risk people surface rather than vanish.
export function correlateTrainingRisk(
  risk: Array<{ email: string; name?: string | null; riskScore: number }>,
  training: Array<{ email: string; name: string | null; completed: number; open: number; overdue: number }>,
): {
  rows: Array<{ email: string; name: string | null; riskScore: number; completed: number; open: number; overdue: number }>;
  bands: Array<{ band: string; count: number; avgCompleted: number; avgOverdue: number }>;
} {
  const trainingByEmail = new Map(training.map((t) => [t.email.toLowerCase(), t]));
  const rows = risk
    .map((r) => {
      const email = r.email.toLowerCase();
      const t = trainingByEmail.get(email);
      return {
        email,
        name: r.name ?? t?.name ?? null,
        riskScore: r.riskScore,
        completed: t?.completed ?? 0,
        open: t?.open ?? 0,
        overdue: t?.overdue ?? 0,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);

  const bandOf = (score: number): string => (score >= 80 ? "critical" : score >= 60 ? "high" : score >= 40 ? "medium" : "low");
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const bands = ["low", "medium", "high", "critical"].map((band) => {
    const members = rows.filter((r) => bandOf(r.riskScore) === band);
    const avg = (pick: (r: (typeof rows)[number]) => number) => (members.length ? round1(members.reduce((s, r) => s + pick(r), 0) / members.length) : 0);
    return { band, count: members.length, avgCompleted: avg((r) => r.completed), avgOverdue: avg((r) => r.overdue) };
  });

  return { rows, bands };
}
