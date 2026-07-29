// Assignment rules — the dashboard's own automation engine. Litmos's native
// rules product (Litmos Assign) is Account-Owner-only and a paid add-on, so
// team admins get their own engine here:
//   - member_joined: when someone new appears in the team (or its sub-teams),
//     assign the rule's courses/learning paths to just that person. New members
//     are detected by diffing current membership against lc_rule_seen_members.
//   - schedule: every N days, (re)assign the rule's content at the team level —
//     team assignment is idempotent in Litmos and automatically reaches members
//     who joined in between.
// Runs happen on the platform cron (`lc-rules`) and on demand from the UI.

import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  lcAssignmentRules,
  lcRuleRuns,
  lcRuleSeenMembers,
  type LcAssignmentRuleRow,
  type LcRuleRunRow,
} from "./schema";
import type { LitmosSource } from "./source";
import { getSource } from "./source";
import { descendantTeamIds } from "./scope";

const DAY = 86_400_000;

export interface RuleInput {
  teamId: string;
  teamName: string;
  name: string;
  trigger: "member_joined" | "schedule";
  intervalDays: number | null;
  courseIds: string[];
  learningPathIds: string[];
  includeSubteams: boolean;
  sendLitmosEmail: boolean;
  createdBy: string;
}

export function parseIdList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Pure: is a schedule rule due to run?
export function scheduleRuleDue(rule: Pick<LcAssignmentRuleRow, "trigger" | "intervalDays" | "lastRunAt">, now: number): boolean {
  if (rule.trigger !== "schedule") return false;
  const interval = Math.max(1, rule.intervalDays ?? 1);
  if (rule.lastRunAt == null) return true;
  return now - rule.lastRunAt >= interval * DAY;
}

// Pure: which members are new since the rule last looked?
export function diffNewMembers(currentIds: string[], seenIds: Iterable<string>): string[] {
  const seen = new Set(seenIds);
  return [...new Set(currentIds)].filter((id) => !seen.has(id));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listRules(scopeTeamIds: string[] | null): Promise<LcAssignmentRuleRow[]> {
  if (scopeTeamIds === null) {
    return db.select().from(lcAssignmentRules).orderBy(desc(lcAssignmentRules.createdAt));
  }
  if (!scopeTeamIds.length) return [];
  return db.select().from(lcAssignmentRules).where(inArray(lcAssignmentRules.teamId, scopeTeamIds)).orderBy(desc(lcAssignmentRules.createdAt));
}

export async function getRule(id: string): Promise<LcAssignmentRuleRow | null> {
  const rows = await db.select().from(lcAssignmentRules).where(eq(lcAssignmentRules.id, id)).limit(1);
  return rows[0] ?? null;
}

const SEEN_INSERT_CHUNK = 500;

export async function createRule(input: RuleInput): Promise<LcAssignmentRuleRow> {
  const now = Date.now();
  const id = randomUUID();

  // member_joined rules act on FUTURE joiners: the current roster must be
  // snapshotted as "already seen" so the first run never mass-assigns to the
  // whole team. Order matters — resolve and record that snapshot BEFORE the
  // rule becomes visible to the cron. We insert the rule as INACTIVE, seed the
  // seen-members, then flip it active in a final step, so a failure or crash
  // mid-seed can never leave an armed rule with an empty seen set (which would
  // treat every existing member as new). If seeding fails we delete the rule.
  const isMemberJoined = input.trigger === "member_joined";
  let memberIds: string[] = [];
  if (isMemberJoined) {
    const source = await getSource();
    memberIds = await collectMemberIds(source, input.teamId, input.includeSubteams);
  }

  await db.insert(lcAssignmentRules).values({
    id,
    teamId: input.teamId,
    teamName: input.teamName,
    name: input.name,
    trigger: input.trigger,
    intervalDays: input.trigger === "schedule" ? Math.max(1, input.intervalDays ?? 7) : null,
    courseIds: JSON.stringify(input.courseIds),
    learningPathIds: JSON.stringify(input.learningPathIds),
    includeSubteams: input.includeSubteams,
    sendLitmosEmail: input.sendLitmosEmail,
    active: !isMemberJoined, // member_joined stays inactive until seeded
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });

  if (isMemberJoined) {
    try {
      for (let i = 0; i < memberIds.length; i += SEEN_INSERT_CHUNK) {
        const chunk = memberIds.slice(i, i + SEEN_INSERT_CHUNK);
        await db
          .insert(lcRuleSeenMembers)
          .values(chunk.map((uid) => ({ id: randomUUID(), ruleId: id, litmosUserId: uid, firstSeenAt: now })))
          .onConflictDoNothing();
      }
      await db.update(lcAssignmentRules).set({ active: true, updatedAt: Date.now() }).where(eq(lcAssignmentRules.id, id));
    } catch (e) {
      // Roll back so a half-seeded rule can't mass-assign on the next tick.
      await db.delete(lcRuleSeenMembers).where(eq(lcRuleSeenMembers.ruleId, id));
      await db.delete(lcAssignmentRules).where(eq(lcAssignmentRules.id, id));
      throw e;
    }
  }
  return (await getRule(id))!;
}

export async function setRuleActive(id: string, active: boolean): Promise<void> {
  await db.update(lcAssignmentRules).set({ active, updatedAt: Date.now() }).where(eq(lcAssignmentRules.id, id));
}

export async function deleteRule(id: string): Promise<void> {
  await db.delete(lcAssignmentRules).where(eq(lcAssignmentRules.id, id));
  await db.delete(lcRuleSeenMembers).where(eq(lcRuleSeenMembers.ruleId, id));
  await db.delete(lcRuleRuns).where(eq(lcRuleRuns.ruleId, id));
}

export async function listRuns(ruleId: string, limit = 20): Promise<LcRuleRunRow[]> {
  return db.select().from(lcRuleRuns).where(eq(lcRuleRuns.ruleId, ruleId)).orderBy(desc(lcRuleRuns.ranAt)).limit(limit);
}

// ─── execution ────────────────────────────────────────────────────────────────

async function collectMemberIds(source: LitmosSource, teamId: string, includeSubteams: boolean): Promise<string[]> {
  const teamIds = [teamId];
  if (includeSubteams) {
    const allTeams = await source.listTeams();
    teamIds.push(...descendantTeamIds(allTeams, [teamId]));
  }
  const ids = new Set<string>();
  for (const tid of teamIds) {
    for (const u of await source.listTeamUsers(tid)) ids.add(u.Id);
  }
  return [...ids];
}

async function recordRun(ruleId: string, status: "success" | "failed" | "skipped", assignedCount: number, detail: string): Promise<void> {
  await db.insert(lcRuleRuns).values({ id: randomUUID(), ruleId, ranAt: Date.now(), status, assignedCount, detail });
}

// Run one rule. `force` (the UI's "Run now") bypasses the schedule-cadence
// check and, for schedule rules, re-runs immediately.
export async function runRule(rule: LcAssignmentRuleRow, opts: { force?: boolean } = {}): Promise<{ status: string; assigned: number; detail: string }> {
  const source = await getSource();
  const courseIds = parseIdList(rule.courseIds);
  const lpIds = parseIdList(rule.learningPathIds);
  if (!courseIds.length && !lpIds.length) {
    await recordRun(rule.id, "skipped", 0, "Rule has no courses or learning paths.");
    return { status: "skipped", assigned: 0, detail: "no content" };
  }

  try {
    if (rule.trigger === "schedule") {
      if (!opts.force && !scheduleRuleDue(rule, Date.now())) {
        return { status: "skipped", assigned: 0, detail: "not due yet" };
      }
      if (courseIds.length) {
        await source.assignCoursesToTeam(rule.teamId, courseIds, { library: false, includeSubteams: rule.includeSubteams });
      }
      if (lpIds.length) {
        await source.assignLearningPathsToTeam(rule.teamId, lpIds);
      }
      const detail = `Team-level assignment: ${courseIds.length} course(s), ${lpIds.length} learning path(s).`;
      await db.update(lcAssignmentRules).set({ lastRunAt: Date.now(), updatedAt: Date.now() }).where(eq(lcAssignmentRules.id, rule.id));
      await recordRun(rule.id, "success", courseIds.length + lpIds.length, detail);
      return { status: "success", assigned: courseIds.length + lpIds.length, detail };
    }

    // member_joined
    const memberIds = await collectMemberIds(source, rule.teamId, rule.includeSubteams);
    const seenRows = await db
      .select({ litmosUserId: lcRuleSeenMembers.litmosUserId })
      .from(lcRuleSeenMembers)
      .where(eq(lcRuleSeenMembers.ruleId, rule.id));
    const newMembers = diffNewMembers(memberIds, seenRows.map((r) => r.litmosUserId));

    let assigned = 0;
    const errors: string[] = [];
    for (const uid of newMembers) {
      try {
        if (courseIds.length) await source.assignCoursesToUser(uid, courseIds, rule.sendLitmosEmail);
        if (lpIds.length) await source.assignLearningPathsToUser(uid, lpIds);
        assigned++;
        // Only mark the member seen once their assignment actually succeeded.
        // A transient Litmos failure (e.g. a 503 under the rate limit) must
        // leave them unseen so the next run retries — otherwise a member is
        // silently skipped forever and never gets their required training.
        await db
          .insert(lcRuleSeenMembers)
          .values({ id: randomUUID(), ruleId: rule.id, litmosUserId: uid, firstSeenAt: Date.now() })
          .onConflictDoNothing();
      } catch (e) {
        errors.push(`${uid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const detail = newMembers.length
      ? `${assigned}/${newMembers.length} new member(s) assigned.${errors.length ? ` Errors: ${errors.slice(0, 3).join("; ")}` : ""}`
      : "No new members.";
    await db.update(lcAssignmentRules).set({ lastRunAt: Date.now(), updatedAt: Date.now() }).where(eq(lcAssignmentRules.id, rule.id));
    await recordRun(rule.id, errors.length && assigned === 0 && newMembers.length ? "failed" : "success", assigned, detail);
    return { status: "success", assigned, detail };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await recordRun(rule.id, "failed", 0, detail);
    return { status: "failed", assigned: 0, detail };
  }
}

// Cron entry point: evaluate every active rule.
export async function runAllRules(): Promise<{ evaluated: number; ran: number; assigned: number }> {
  const rules = await db.select().from(lcAssignmentRules).where(and(eq(lcAssignmentRules.active, true)));
  let ran = 0;
  let assigned = 0;
  for (const rule of rules) {
    const result = await runRule(rule);
    if (result.status !== "skipped" || result.detail !== "not due yet") ran++;
    assigned += result.assigned;
  }
  return { evaluated: rules.length, ran, assigned };
}
