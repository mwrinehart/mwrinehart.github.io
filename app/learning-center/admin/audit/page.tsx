// Dashboard audit log — every mutating action taken through the Learning
// Center, scoped to the admin's teams (owners see everything).

import { getAdminContext } from "@/lib/modules/learning-center/context";
import { listAudit } from "@/lib/modules/learning-center/audit";
import { LcEmpty, LcPageHeader, LcTable } from "@/components/learning-center/ui";

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function AuditPage() {
  const ctx = await getAdminContext();
  const rows = await listAudit(ctx.isOwner ? null : ctx.scopeIds, 300);

  return (
    <>
      <LcPageHeader
        title="Audit log"
        subtitle="Every change made through this dashboard. Actions taken directly in Litmos are covered by Litmos's own activity logs."
      />
      {rows.length ? (
        <LcTable
          head={
            <>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              <th>Team</th>
              <th>Detail</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="text-lc-muted whitespace-nowrap">{when(row.createdAt)}</td>
              <td>
                <div className="font-medium text-lc-ink">{row.actorEmail}</div>
                <div className="text-xs text-lc-muted">{row.actorRole.replaceAll("_", " ")}</div>
              </td>
              <td className="font-medium text-lc-ink">{row.action.replaceAll("_", " ")}</td>
              <td className="text-lc-muted">{row.targetLabel ?? row.targetId ?? "—"}</td>
              <td className="text-lc-muted">{row.teamId ? (ctx.allTeams.find((t) => t.Id === row.teamId)?.Name ?? row.teamId) : "—"}</td>
              <td className="text-xs text-lc-muted max-w-72">{row.detail ?? ""}</td>
            </tr>
          ))}
        </LcTable>
      ) : (
        <LcEmpty title="No dashboard activity yet" />
      )}
    </>
  );
}
