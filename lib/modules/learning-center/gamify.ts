// Tenant gamification, layered on top of Litmos's read-only gamification API.
// Litmos exposes points/badges but no way to configure or grant them via API —
// so tenants get a dashboard-owned layer: custom badges (manual or auto
// criteria), bonus points, and combined leaderboards (Litmos points + awards).

import { randomUUID } from "crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { lcAwards, lcBadges, lcTenantSettings, type LcAwardRow, type LcBadgeRow } from "./schema";
import type { LitmosSource } from "./source";
import type { TeamGamificationEntry } from "./types";
import { descendantTeamIds } from "./scope";
import { gatherTeamProgress } from "./reports";

export type BadgeCriteria = "manual" | "course_completed" | "courses_count";

export interface BadgeInput {
  teamId: string; // tenant root
  title: string;
  description?: string;
  emoji: string;
  color: string;
  criteriaType: BadgeCriteria;
  criteriaCourseId?: string | null;
  criteriaCount?: number | null;
  bonusPoints: number;
  createdBy: string;
}

// ─── badge CRUD ───────────────────────────────────────────────────────────────

export async function listBadges(tenantRootTeamId: string): Promise<LcBadgeRow[]> {
  return db.select().from(lcBadges).where(eq(lcBadges.teamId, tenantRootTeamId)).orderBy(desc(lcBadges.createdAt));
}

export async function createBadge(input: BadgeInput): Promise<string> {
  const id = randomUUID();
  await db.insert(lcBadges).values({
    id,
    teamId: input.teamId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    emoji: input.emoji.trim() || "★",
    color: input.color,
    criteriaType: input.criteriaType,
    criteriaCourseId: input.criteriaType === "course_completed" ? (input.criteriaCourseId ?? null) : null,
    criteriaCount: input.criteriaType === "courses_count" ? Math.max(1, input.criteriaCount ?? 1) : null,
    bonusPoints: Math.max(0, Math.min(100_000, Math.round(input.bonusPoints || 0))),
    active: true,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  });
  return id;
}

export async function setBadgeActive(tenantRootTeamId: string, badgeId: string, active: boolean): Promise<void> {
  await db.update(lcBadges).set({ active }).where(and(eq(lcBadges.id, badgeId), eq(lcBadges.teamId, tenantRootTeamId)));
}

export async function deleteBadge(tenantRootTeamId: string, badgeId: string): Promise<void> {
  await db.delete(lcBadges).where(and(eq(lcBadges.id, badgeId), eq(lcBadges.teamId, tenantRootTeamId)));
  await db.delete(lcAwards).where(and(eq(lcAwards.badgeId, badgeId), eq(lcAwards.teamId, tenantRootTeamId)));
}

// ─── awards ───────────────────────────────────────────────────────────────────

export async function listAwards(tenantRootTeamId: string, limit = 100): Promise<LcAwardRow[]> {
  return db.select().from(lcAwards).where(eq(lcAwards.teamId, tenantRootTeamId)).orderBy(desc(lcAwards.createdAt)).limit(limit);
}

export async function listAwardsForUser(litmosUserId: string): Promise<LcAwardRow[]> {
  return db.select().from(lcAwards).where(eq(lcAwards.litmosUserId, litmosUserId)).orderBy(desc(lcAwards.createdAt));
}

// Manual award: a badge (with its bonus points) and/or bare bonus points.
// The partial unique index (badge_id, litmos_user_id) makes badge grants
// idempotent per user.
export async function grantAward(input: {
  teamId: string;
  litmosUserId: string;
  badge?: LcBadgeRow | null;
  points?: number;
  reason?: string;
  awardedBy: string;
}): Promise<boolean> {
  const points = input.badge ? input.badge.bonusPoints : Math.max(0, Math.min(100_000, Math.round(input.points ?? 0)));
  const result = await db
    .insert(lcAwards)
    .values({
      id: randomUUID(),
      teamId: input.teamId,
      litmosUserId: input.litmosUserId,
      badgeId: input.badge?.id ?? null,
      points,
      reason: input.reason?.trim() || (input.badge ? input.badge.title : null),
      awardedBy: input.awardedBy,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .returning({ id: lcAwards.id });
  return result.length > 0;
}

export async function revokeAward(tenantRootTeamId: string, awardId: string): Promise<void> {
  await db.delete(lcAwards).where(and(eq(lcAwards.id, awardId), eq(lcAwards.teamId, tenantRootTeamId)));
}

// ─── combined leaderboard math (pure) ─────────────────────────────────────────

export interface AwardTotals {
  points: number;
  badges: number;
}

export function totalsByUser(awards: Array<Pick<LcAwardRow, "litmosUserId" | "points" | "badgeId">>): Map<string, AwardTotals> {
  const map = new Map<string, AwardTotals>();
  for (const a of awards) {
    const entry = map.get(a.litmosUserId) ?? { points: 0, badges: 0 };
    entry.points += a.points;
    if (a.badgeId) entry.badges += 1;
    map.set(a.litmosUserId, entry);
  }
  return map;
}

// Litmos gamification entries merged with dashboard awards, ready for
// buildLeaderboard(). completionBonus adds pointsPerCompletion × completions
// when the tenant configured a completion bonus.
export function mergeGamification(
  litmosEntries: TeamGamificationEntry[],
  awardTotals: Map<string, AwardTotals>,
  completions?: Map<string, number>,
  pointsPerCompletion = 0,
): TeamGamificationEntry[] {
  return litmosEntries.map((e) => {
    const extra = awardTotals.get(e.UserId) ?? { points: 0, badges: 0 };
    const bonus = pointsPerCompletion > 0 ? (completions?.get(e.UserId) ?? 0) * pointsPerCompletion : 0;
    return {
      ...e,
      TotalPointsEarned: e.TotalPointsEarned + extra.points + bonus,
      TotalBadgesEarned: e.TotalBadgesEarned + extra.badges,
    };
  });
}

// ─── auto-award evaluation ────────────────────────────────────────────────────

// Evaluate a tenant's auto badges (course_completed / courses_count) against
// current member progress and grant anything newly earned. Idempotent (unique
// index). Runs from the lc-rules cron and from the Gamification page.
export async function evaluateAutoAwards(source: LitmosSource, tenantRootTeamId: string): Promise<{ evaluated: number; granted: number }> {
  const badges = (await listBadges(tenantRootTeamId)).filter((b) => b.active && b.criteriaType !== "manual");
  if (!badges.length) return { evaluated: 0, granted: 0 };

  const allTeams = await source.listTeams();
  const scope = [tenantRootTeamId, ...descendantTeamIds(allTeams, [tenantRootTeamId])];
  const progress = await gatherTeamProgress(source, scope);

  let granted = 0;
  for (const badge of badges) {
    for (const member of progress.members) {
      let earned = false;
      if (badge.criteriaType === "course_completed" && badge.criteriaCourseId) {
        earned = member.courses.some((c) => c.Id === badge.criteriaCourseId && c.Complete);
      } else if (badge.criteriaType === "courses_count") {
        earned = member.completed >= (badge.criteriaCount ?? 1);
      }
      if (earned) {
        const inserted = await grantAward({ teamId: tenantRootTeamId, litmosUserId: member.user.Id, badge, awardedBy: "auto" });
        if (inserted) granted++;
      }
    }
  }
  return { evaluated: badges.length, granted };
}

// Cron sweep: evaluate auto awards for every tenant that has any active auto
// badge configured.
export async function runAutoAwardSweep(source: LitmosSource): Promise<{ tenants: number; granted: number }> {
  const rows = await db
    .selectDistinct({ teamId: lcBadges.teamId })
    .from(lcBadges)
    .where(and(eq(lcBadges.active, true), inArray(lcBadges.criteriaType, ["course_completed", "courses_count"])));
  let granted = 0;
  for (const { teamId } of rows) {
    try {
      granted += (await evaluateAutoAwards(source, teamId)).granted;
    } catch {
      // tenant evaluation failure shouldn't block others; next tick retries
    }
  }
  return { tenants: rows.length, granted };
}

// Whether the tenant has gamification display enabled at all.
export async function gamificationFlags(tenantRootTeamId: string | null): Promise<{ enabled: boolean; showLeaderboard: boolean; pointsPerCompletion: number }> {
  if (!tenantRootTeamId) return { enabled: true, showLeaderboard: true, pointsPerCompletion: 0 };
  const rows = await db.select().from(lcTenantSettings).where(eq(lcTenantSettings.teamId, tenantRootTeamId)).limit(1);
  const row = rows[0];
  if (!row) return { enabled: true, showLeaderboard: true, pointsPerCompletion: 0 };
  return { enabled: row.gamificationEnabled, showLeaderboard: row.showLeaderboard, pointsPerCompletion: row.pointsPerCompletion };
}

// Badges (with metadata) earned by a user, for the learner strip and admin
// user detail.
export async function badgesForUser(litmosUserId: string): Promise<Array<{ award: LcAwardRow; badge: LcBadgeRow }>> {
  const awards = await db.select().from(lcAwards).where(and(eq(lcAwards.litmosUserId, litmosUserId))).orderBy(desc(lcAwards.createdAt));
  const badgeIds = [...new Set(awards.map((a) => a.badgeId).filter((x): x is string => !!x))];
  if (!badgeIds.length) return [];
  const badges = await db.select().from(lcBadges).where(inArray(lcBadges.id, badgeIds));
  const byId = new Map(badges.map((b) => [b.id, b]));
  return awards
    .filter((a) => a.badgeId && byId.has(a.badgeId))
    .map((a) => ({ award: a, badge: byId.get(a.badgeId as string)! }));
}

// Bare bonus-point awards (no badge) for display in the awards log.
export async function bonusAwards(tenantRootTeamId: string, limit = 50): Promise<LcAwardRow[]> {
  return db
    .select()
    .from(lcAwards)
    .where(and(eq(lcAwards.teamId, tenantRootTeamId), isNull(lcAwards.badgeId)))
    .orderBy(desc(lcAwards.createdAt))
    .limit(limit);
}
