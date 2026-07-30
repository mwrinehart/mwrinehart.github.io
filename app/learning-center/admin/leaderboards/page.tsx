// Leaderboards & gamification for the team and its sub-teams. Litmos exposes
// raw per-member points/badges; ranking, podium, and sub-team standings are
// computed by the dashboard. Point rules/badges themselves are account-level
// in Litmos (no API) — the per-user reset is the one write, owner-gated.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, assertUserInScope, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, childTeams, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { buildLeaderboard, rankSubTeams } from "@/lib/modules/learning-center/leaderboard";
import { gamificationFlags, listAwards, mergeGamification, totalsByUser } from "@/lib/modules/learning-center/gamify";
import { descendantTeamIds } from "@/lib/modules/learning-center/scope";
import { gatherTeamProgress } from "@/lib/modules/learning-center/reports";
import { tenantRootId } from "@/lib/modules/learning-center/tenant";
import { isGamificationDisabled, type TeamGamificationEntry } from "@/lib/modules/learning-center/types";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/leaderboards?${q.toString()}`);
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Leaderboards" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  // Dashboard awards + completion bonus for the tenant are merged into the
  // Litmos gamification numbers so the leaderboard reflects everything.
  const rootId = tenantRootId(ctx.allTeams, team.Id);
  const [awards, flags] = await Promise.all([listAwards(rootId, 5000), gamificationFlags(rootId)]);
  const awardTotals = totalsByUser(awards);

  // The per-completion bonus needs each member's completed-course count — only
  // gathered (one fan-out) when the tenant actually configured a bonus.
  let completions: Map<string, number> | undefined;
  if (flags.pointsPerCompletion > 0) {
    const teamScope = [team.Id, ...descendantTeamIds(ctx.allTeams, [team.Id])].filter((id) => ctx.scopeIds.includes(id));
    const progress = await gatherTeamProgress(ctx.source, teamScope);
    completions = new Map(progress.members.map((m) => [m.user.Id, m.completed]));
  }
  const merge = (rows: TeamGamificationEntry[]) => mergeGamification(rows, awardTotals, completions, flags.pointsPerCompletion);

  let entries: TeamGamificationEntry[] = [];
  let disabled = false;
  try {
    entries = merge(await ctx.source.getTeamGamificationDetails(team.Id));
  } catch (e) {
    if (isGamificationDisabled(e)) disabled = true;
    else throw e;
  }

  const board = buildLeaderboard(entries);
  const subTeams = childTeams(ctx.allTeams, team.Id).filter((t) => ctx.scopeIds.includes(t.Id));
  const subEntries = await Promise.all(
    subTeams.map(async (t) => ({
      teamId: t.Id,
      teamName: t.Name,
      entries: merge(await ctx.source.getTeamGamificationDetails(t.Id).catch(() => [] as TeamGamificationEntry[])),
    })),
  );
  const standings = rankSubTeams(subEntries);
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const podium = board.slice(0, 3);

  async function resetGamification(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    if (!c.isOwner) back(teamId, { error: "Only account owners can reset a member's points and badges." });
    const userId = String(formData.get("userId") ?? "");
    const label = String(formData.get("label") ?? userId);
    await assertUserInScope(c, userId);
    try {
      await c.source.resetUserGamification(userId);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Reset failed." });
    }
    await writeAudit(c.session, { action: "gamification_reset", targetType: "user", targetId: userId, targetLabel: label, teamId });
    revalidatePath("/learning-center/admin/leaderboards");
    back(teamId, { ok: `${label}'s points and badges were reset.` });
  }

  return (
    <>
      <LcPageHeader
        title="Leaderboards"
        subtitle={`Points and badges across ${team.Name}${subTeams.length ? " and its sub-teams" : ""}. Ranked by points — the Litmos leaderboard rule.`}
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      {!flags.enabled ? (
        <LcEmpty title="Gamification is turned off for this tenant">
          Turn it back on under <span className="font-semibold">Gamification</span> to show points, badges, and leaderboards.
        </LcEmpty>
      ) : disabled ? (
        <LcEmpty title="Gamification is turned off for this Litmos account">
          An account owner can enable it in Litmos under Account Settings → Litmos Features → Gamification, or award dashboard badges/points under
          Gamification. Leaderboards light up here automatically.
        </LcEmpty>
      ) : !board.length ? (
        <LcEmpty title="No gamification activity yet">Points appear as members complete courses that award them.</LcEmpty>
      ) : (
        <>
          {/* Podium */}
          <div className="grid gap-4 sm:grid-cols-3 mb-8">
            {podium.map((row, i) => (
              <LcPanel key={row.userId} className={i === 0 ? "bg-lc-purple text-white border-lc-purple" : ""}>
                <div className={`text-xs font-bold uppercase tracking-widest ${i === 0 ? "text-white/70" : "text-lc-muted"}`}>
                  {i === 0 ? "★ First place" : i === 1 ? "Second" : "Third"}
                </div>
                <div className={`text-xl font-bold mt-1 ${i === 0 ? "text-white" : "text-lc-ink"}`}>{row.name}</div>
                <div className={`text-sm mt-1 font-semibold ${i === 0 ? "text-white/85" : "text-lc-muted"}`}>
                  {row.points.toLocaleString()} pts · {row.badges} badge{row.badges === 1 ? "" : "s"}
                </div>
              </LcPanel>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <section>
              <h2 className="text-lg font-bold text-lc-ink mb-3">Full standings — {team.Name}</h2>
              <LcTable
                head={
                  <>
                    <th className="w-14">Rank</th>
                    <th>Member</th>
                    <th>Points</th>
                    <th>Badges</th>
                    {ctx.isOwner && <th className="w-24"></th>}
                  </>
                }
              >
                {board.map((row) => (
                  <tr key={row.userId}>
                    <td className="font-bold text-lc-purple">#{row.rank}</td>
                    <td>
                      <div className="font-semibold text-lc-ink">{row.name}</div>
                      {row.email && <div className="text-xs text-lc-muted">{row.email}</div>}
                    </td>
                    <td className="font-semibold text-lc-ink">{row.points.toLocaleString()}</td>
                    <td className="text-lc-muted">{row.badges}</td>
                    {ctx.isOwner && (
                      <td className="text-right">
                        <form action={resetGamification} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="userId" value={row.userId} />
                          <input type="hidden" name="label" value={row.name} />
                          <button type="submit" className={lcBtnGhost} title="Reset this member's points and badges to zero">
                            Reset
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </LcTable>
            </section>

            <section>
              <h2 className="text-lg font-bold text-lc-ink mb-3">Sub-team standings</h2>
              {standings.length ? (
                <div className="space-y-3">
                  {standings.map((s, i) => (
                    <LcPanel key={s.teamId} className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold text-lc-ink">
                          <span className="text-lc-purple">#{i + 1}</span> {s.teamName}
                        </div>
                        <div className="text-xs text-lc-muted mt-0.5">
                          {s.members} member(s) · {s.totalPoints.toLocaleString()} total pts · {s.totalBadges} badges
                        </div>
                      </div>
                      <LcBadge tone={i === 0 ? "purple" : "neutral"}>{s.avgPoints.toLocaleString()} avg pts</LcBadge>
                    </LcPanel>
                  ))}
                  <p className="text-xs text-lc-muted">Ranked by average points per member, so small sub-teams compete fairly with big ones.</p>
                </div>
              ) : (
                <LcEmpty title="No sub-teams under this team" />
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
