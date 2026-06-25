import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { listPeople, riskBand } from "@/lib/modules/behavior/risk";
import { getOrgRiskTrend, recomputeRiskForOrg } from "@/lib/modules/behavior/scoring";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const TREND_LABEL = { increasing: "↑ increasing", decreasing: "↓ decreasing", stable: "→ stable" } as const;

export default async function RiskScoresPage() {
  const { orgId } = await requireTenant();
  const [people, trend] = await Promise.all([listPeople(orgId), getOrgRiskTrend(orgId)]);

  async function recompute() {
    "use server";
    const { orgId } = await requireTenant("member");
    await recomputeRiskForOrg(orgId);
    revalidatePath("/behavior/risk");
  }

  return (
    <>
      <PageHeader
        title="Risk scores"
        subtitle="Per-person security risk, derived from ingested signals. Highest first."
        action={
          <form action={recompute}>
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
              Recompute
            </button>
          </form>
        }
      />

      {trend.points.length >= 2 && (
        <Panel className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Org risk trend</h3>
            <span className="text-sm text-jericho-muted">{TREND_LABEL[trend.direction]}</span>
          </div>
          <div className="flex items-end gap-1 h-16 mt-3">
            {trend.points.map((p) => (
              <div
                key={p.date}
                title={`${p.date}: ${p.avg}`}
                className="flex-1 bg-jericho-accent/60 rounded-t"
                style={{ height: `${Math.max(4, p.avg)}%` }}
              />
            ))}
          </div>
        </Panel>
      )}

      {people.length === 0 ? (
        <EmptyState title="No people yet">Configure a data source (Sources tab) and sync, or load sample data from the overview.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Department</th>
                <th className="px-5 py-3 font-medium text-right">Risk</th>
                <th className="px-5 py-3 font-medium">Band</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const band = riskBand(p.riskScore);
                return (
                  <tr key={p.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-5 py-3">
                      <div>{p.name ?? "—"}</div>
                      <div className="text-xs text-jericho-muted">{p.email}</div>
                    </td>
                    <td className="px-5 py-3 text-jericho-muted">{p.department ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-medium">{p.riskScore}</td>
                    <td className="px-5 py-3">
                      <Badge tone={band === "low" ? "low" : band === "medium" ? "medium" : "high"}>{band}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
