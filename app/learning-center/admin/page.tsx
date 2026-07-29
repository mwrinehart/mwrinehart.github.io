// Admin overview: team health at a glance — members, completion, overdue,
// compliance risk — plus the members who most need chasing and recent
// dashboard activity.

import Link from "next/link";
import { getAdminContext } from "@/lib/modules/learning-center/context";
import { computeOverview, gatherTeamProgress } from "@/lib/modules/learning-center/reports";
import { listAudit } from "@/lib/modules/learning-center/audit";
import { LcBadge, LcEmpty, LcPageHeader, LcPanel, LcStat, LcTable } from "@/components/learning-center/ui";

function ago(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AdminOverview() {
  const ctx = await getAdminContext();
  const data = await gatherTeamProgress(ctx.source, ctx.scopeIds);
  const metrics = computeOverview(data);
  const audit = await listAudit(ctx.isOwner ? null : ctx.scopeIds, 8);

  const needsAttention = data.members
    .filter((m) => m.overdue > 0 || m.lapsed > 0 || m.expiringSoon > 0)
    .sort((a, b) => b.overdue + b.lapsed * 2 - (a.overdue + a.lapsed * 2))
    .slice(0, 8);

  return (
    <>
      <LcPageHeader
        title="Overview"
        subtitle={
          ctx.isOwner
            ? "Account-wide view across every team."
            : `Your scope: ${ctx.scopedTeams.map((t) => t.Name).join(", ")}`
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-8">
        <LcStat label="Team members" value={metrics.members} hint={metrics.capped ? "First 200 members shown" : undefined} />
        <LcStat label="Completion rate" value={`${metrics.completionRate}%`} hint={`${metrics.completed} of ${metrics.assignments} assignments`} />
        <LcStat label="Overdue items" value={metrics.overdue} hint={`${metrics.overdueMembers} member(s) affected`} alert={metrics.overdue > 0} />
        <LcStat
          label="Compliance risk"
          value={metrics.lapsed + metrics.expiringSoon}
          hint={`${metrics.lapsed} lapsed · ${metrics.expiringSoon} expiring in 30d`}
          alert={metrics.lapsed > 0}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Members needing attention</h2>
          {needsAttention.length ? (
            <LcTable
              head={
                <>
                  <th>Member</th>
                  <th>Overdue</th>
                  <th>Compliance</th>
                  <th>Progress</th>
                </>
              }
            >
              {needsAttention.map((m) => (
                <tr key={m.user.Id}>
                  <td>
                    <div className="font-semibold text-lc-ink">
                      {m.user.FirstName} {m.user.LastName}
                    </div>
                    <div className="text-xs text-lc-muted">{m.user.Email}</div>
                  </td>
                  <td>{m.overdue ? <LcBadge tone="amber">{m.overdue} overdue</LcBadge> : <span className="text-lc-muted">—</span>}</td>
                  <td>
                    {m.lapsed ? (
                      <LcBadge tone="amber">{m.lapsed} lapsed</LcBadge>
                    ) : m.expiringSoon ? (
                      <LcBadge tone="ink">{m.expiringSoon} expiring</LcBadge>
                    ) : (
                      <span className="text-lc-muted">—</span>
                    )}
                  </td>
                  <td className="text-lc-muted">
                    {m.completed}/{m.courses.length} done
                  </td>
                </tr>
              ))}
            </LcTable>
          ) : (
            <LcEmpty title="Everyone is on track">No overdue training or compliance issues in your teams.</LcEmpty>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-lc-ink mb-3">Recent admin activity</h2>
          <LcPanel className="p-0 divide-y divide-lc-line">
            {audit.length ? (
              audit.map((row) => (
                <div key={row.id} className="px-4 py-3">
                  <div className="text-sm text-lc-ink">
                    <span className="font-semibold">{row.actorEmail}</span>{" "}
                    <span className="text-lc-muted">{row.action.replaceAll("_", " ")}</span>
                    {row.targetLabel && <span className="font-medium"> — {row.targetLabel}</span>}
                  </div>
                  <div className="text-xs text-lc-muted mt-0.5">{ago(row.createdAt)}</div>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-sm text-lc-muted text-center">No dashboard actions yet.</div>
            )}
          </LcPanel>
          <div className="mt-3 text-right">
            <Link href="/learning-center/admin/audit" className="text-xs font-semibold text-lc-purple hover:underline">
              Full audit log →
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
