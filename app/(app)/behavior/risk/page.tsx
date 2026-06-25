import { requireTenant } from "@/lib/platform/org";
import { listPeople, riskBand } from "@/lib/modules/behavior/risk";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function RiskScoresPage() {
  const { orgId } = await requireTenant();
  const people = await listPeople(orgId);

  return (
    <>
      <PageHeader title="Risk scores" subtitle="Per-person security risk, highest first." />
      {people.length === 0 ? (
        <EmptyState title="No people yet">Load sample data from the Behavior overview to populate this view.</EmptyState>
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
