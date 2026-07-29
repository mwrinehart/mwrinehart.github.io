// Reports: member progress and assignment detail with CSV export, a recent
// results feed (the /results/details delta), and recent achievements with
// certificates. Exports run through /learning-center/api/export with the same
// session + scope checks as this page.

import { getAdminContext, selectedTeam } from "@/lib/modules/learning-center/context";
import { buildTeamTree, descendantTeamIds, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { computeOverview, gatherTeamProgress } from "@/lib/modules/learning-center/reports";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcPageHeader, LcPanel, LcTable, lcBtnPrimary, lcBtnSecondary } from "@/components/learning-center/ui";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; days?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Reports" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const days = Math.min(90, Math.max(1, Number(params.days) || 30));
  const teamScope = [team.Id, ...descendantTeamIds(ctx.allTeams, [team.Id])].filter((id) => ctx.scopeIds.includes(id));
  const data = await gatherTeamProgress(ctx.source, teamScope);
  const metrics = computeOverview(data);

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const memberIds = new Set(data.members.map((m) => m.user.Id));
  const [results, achievements] = await Promise.all([
    ctx.source.listResultsSince(since).then((rows) => rows.filter((r) => memberIds.has(r.Id))),
    ctx.source.listAchievements({ since: since.slice(0, 10) }).then((rows) => rows.filter((a) => memberIds.has(a.UserId))),
  ]);
  const recentCompletions = results
    .filter((r) => r.Complete && r.CompletedDate)
    .sort((a, b) => Date.parse(b.CompletedDate ?? "") - Date.parse(a.CompletedDate ?? ""))
    .slice(0, 25);

  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const exportBase = `/learning-center/api/export?team=${encodeURIComponent(team.Id)}`;

  return (
    <>
      <LcPageHeader
        title="Reports"
        subtitle={`${team.Name}${teamScope.length > 1 ? ` + ${teamScope.length - 1} sub-team(s)` : ""} · ${metrics.members} member(s) · ${metrics.completionRate}% completion`}
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />

      <div className="flex flex-wrap gap-3 mb-8">
        <a href={`${exportBase}&type=members`} className={lcBtnPrimary} download>
          ⬇ Member progress CSV
        </a>
        <a href={`${exportBase}&type=assignments`} className={lcBtnSecondary} download>
          ⬇ Assignment detail CSV
        </a>
        {data.capped && <LcBadge tone="amber">Large team — reports cover the first 200 members</LcBadge>}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-lc-ink">Completions — last {days} days</h2>
            <form method="GET" className="flex items-center gap-2 text-xs">
              <input type="hidden" name="team" value={team.Id} />
              <select name="days" defaultValue={String(days)} className="rounded-lg border border-lc-line bg-white px-2 py-1.5 text-xs font-medium">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
              <button type="submit" className={lcBtnSecondary}>
                Apply
              </button>
            </form>
          </div>
          {recentCompletions.length ? (
            <LcTable
              head={
                <>
                  <th>Member</th>
                  <th>Course</th>
                  <th>Completed</th>
                  <th>Score</th>
                </>
              }
            >
              {recentCompletions.map((r, i) => (
                <tr key={`${r.Id}-${r.CourseId}-${i}`}>
                  <td>
                    <div className="font-semibold text-lc-ink">
                      {r.FirstName} {r.LastName}
                    </div>
                    <div className="text-xs text-lc-muted">{r.Email}</div>
                  </td>
                  <td className="text-lc-ink">{r.CourseName}</td>
                  <td className="text-lc-muted whitespace-nowrap">{fmt(r.CompletedDate)}</td>
                  <td className="text-lc-muted">{Math.round(r.PercentageComplete)}%</td>
                </tr>
              ))}
            </LcTable>
          ) : (
            <LcEmpty title="No completions in this window" />
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Achievements & certificates</h2>
          {achievements.length ? (
            <LcPanel className="p-0 divide-y divide-lc-line max-h-[36rem] overflow-y-auto">
              {achievements
                .sort((a, b) => Date.parse(b.AchievementDate) - Date.parse(a.AchievementDate))
                .slice(0, 30)
                .map((a, i) => (
                  <div key={`${a.UserId}-${a.CourseId}-${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-lc-ink">
                        {a.FirstName} {a.LastName} <span className="text-lc-muted font-normal">— {a.Title}</span>
                      </div>
                      <div className="text-xs text-lc-muted mt-0.5">
                        {a.Type ?? "Achievement"} · {fmt(a.AchievementDate)}
                        {typeof a.Score === "number" ? ` · score ${a.Score}` : ""}
                      </div>
                    </div>
                    {a.CertificateId && <LcBadge tone="purple">Certificate</LcBadge>}
                  </div>
                ))}
            </LcPanel>
          ) : (
            <LcEmpty title="No achievements in this window" />
          )}
        </section>
      </div>
    </>
  );
}
