import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { riskOverview, riskBand } from "@/lib/modules/behavior/risk";
import { seedBehaviorDemo } from "@/lib/modules/behavior/seed";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

// Behavior module overview — the human-risk command center (rebuilt from CBM's
// "Command Center" dashboard).
export default async function BehaviorOverviewPage() {
  const { orgId, role } = await requireTenant();
  const o = await riskOverview(orgId);

  async function loadSample() {
    "use server";
    const { orgId } = await requireTenant("member");
    await seedBehaviorDemo(orgId);
    revalidatePath("/behavior");
  }

  return (
    <>
      <PageHeader
        title="Behavior"
        subtitle="Human-risk management — risk scoring, behaviors, nudges, and threat pulse. Rebuilt from CBM-Next."
        action={
          o.peopleCount === 0 ? (
            <form action={loadSample}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                Load sample data
              </button>
            </form>
          ) : undefined
        }
      />

      {o.peopleCount === 0 ? (
        <EmptyState title="No monitored people yet">
          This org has no behavior data. In production this is populated by the data-source sync (Jericho app, Litmos).
          {role !== "viewer" && " Use “Load sample data” to see the module working end-to-end."}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Stat label="Monitored people" value={o.peopleCount} />
            <Stat label="Avg risk score" value={o.avgRisk} hint="0–100" />
            <Stat label="Open behaviors" value={o.openBehaviors} />
            <Stat label="High / critical" value={o.bands.high + o.bands.critical} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Panel>
              <h3 className="font-medium mb-3">Risk distribution</h3>
              <div className="space-y-2">
                {(["critical", "high", "medium", "low"] as const).map((band) => (
                  <div key={band} className="flex items-center gap-3">
                    <Badge tone={band === "low" ? "low" : band === "medium" ? "medium" : "high"}>{band}</Badge>
                    <div className="flex-1 h-2 rounded bg-jericho-border overflow-hidden">
                      <div
                        className="h-full bg-jericho-accent"
                        style={{ width: `${o.peopleCount ? (o.bands[band] / o.peopleCount) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-sm text-jericho-muted w-8 text-right">{o.bands[band]}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">Top risers</h3>
                <Link href="/behavior/risk" className="text-sm text-jericho-accent hover:underline">
                  View all →
                </Link>
              </div>
              <ul className="space-y-2">
                {o.topRisers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.name ?? p.email}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-jericho-muted">{p.riskScore}</span>
                      <Badge tone={riskBand(p.riskScore) === "low" ? "low" : riskBand(p.riskScore) === "medium" ? "medium" : "high"}>
                        {riskBand(p.riskScore)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="mt-4 flex gap-3 text-sm">
            <Link href="/behavior/behaviors" className="text-jericho-accent hover:underline">
              Behaviors →
            </Link>
            <Link href="/behavior/pulse" className="text-jericho-accent hover:underline">
              Threat Pulse →
            </Link>
          </div>
        </>
      )}
    </>
  );
}
