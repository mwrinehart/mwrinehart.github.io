// Leaderboard computation. Litmos exposes raw per-member points/badges
// (/teams/{id}/gamificationdetails) but no leaderboard endpoint — ranking,
// tie handling, and sub-team rollups are computed here. Pure functions.

import type { TeamGamificationEntry } from "./types";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  email?: string;
  points: number;
  badges: number;
}

// Rank by points (Litmos leaderboards rank by points, not badge count), badges
// as tiebreaker, then name for stability. Ties share a rank (1224 ranking).
export function buildLeaderboard(entries: TeamGamificationEntry[]): LeaderboardRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.TotalPointsEarned !== a.TotalPointsEarned) return b.TotalPointsEarned - a.TotalPointsEarned;
    if (b.TotalBadgesEarned !== a.TotalBadgesEarned) return b.TotalBadgesEarned - a.TotalBadgesEarned;
    return `${a.FirstName} ${a.LastName}`.localeCompare(`${b.FirstName} ${b.LastName}`);
  });
  const rows: LeaderboardRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const prev = rows[i - 1];
    const tiedWithPrev =
      prev !== undefined && sorted[i - 1].TotalPointsEarned === e.TotalPointsEarned && sorted[i - 1].TotalBadgesEarned === e.TotalBadgesEarned;
    rows.push({
      rank: tiedWithPrev ? prev.rank : i + 1,
      userId: e.UserId,
      name: `${e.FirstName} ${e.LastName}`.trim(),
      email: e.Email,
      points: e.TotalPointsEarned,
      badges: e.TotalBadgesEarned,
    });
  }
  return rows;
}

export interface SubTeamStanding {
  teamId: string;
  teamName: string;
  members: number;
  totalPoints: number;
  avgPoints: number;
  totalBadges: number;
}

// Compare sub-teams fairly: ranked by AVERAGE points per member (a 3-person
// sub-team can beat a 30-person one), totals shown alongside.
export function rankSubTeams(perTeam: Array<{ teamId: string; teamName: string; entries: TeamGamificationEntry[] }>): SubTeamStanding[] {
  return perTeam
    .map(({ teamId, teamName, entries }) => {
      const totalPoints = entries.reduce((sum, e) => sum + e.TotalPointsEarned, 0);
      const totalBadges = entries.reduce((sum, e) => sum + e.TotalBadgesEarned, 0);
      return {
        teamId,
        teamName,
        members: entries.length,
        totalPoints,
        totalBadges,
        avgPoints: entries.length ? Math.round(totalPoints / entries.length) : 0,
      };
    })
    .sort((a, b) => b.avgPoints - a.avgPoints || b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName));
}
