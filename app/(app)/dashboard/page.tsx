import Link from "next/link";
import { requireTenant } from "@/lib/platform/org";
import { MODULES } from "@/lib/platform/modules";
import { riskOverview } from "@/lib/modules/behavior/risk";
import { PageHeader, Panel, Stat } from "@/components/ui";

// The unified landing page. One overview across every module — the thing none of
// the four source apps could show on its own.
export default async function DashboardPage() {
  const { orgId, role } = await requireTenant();
  const behavior = await riskOverview(orgId);

  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="One workspace for human-risk, compliance, content, and campaign simulation."
        action={<span className="text-xs text-jericho-muted self-center">role: {role}</span>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Monitored people" value={behavior.peopleCount} hint="Behavior module" />
        <Stat label="Avg risk score" value={behavior.avgRisk} hint="0–100" />
        <Stat label="Open behaviors" value={behavior.openBehaviors} hint="Unresolved" />
        <Stat label="High / critical" value={behavior.bands.high + behavior.bands.critical} hint="People at risk" />
      </div>

      <h2 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Modules</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MODULES.map((m) => (
          <Link key={m.id} href={m.href} className="block">
            <Panel className="hover:border-jericho-accent transition-colors h-full">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl" aria-hidden>
                  {m.icon}
                </span>
                <span className="font-medium">{m.label}</span>
                <span
                  className={`ml-auto text-[10px] uppercase tracking-wide ${
                    m.status === "live" ? "text-jericho-good" : "text-jericho-muted"
                  }`}
                >
                  {m.status}
                </span>
              </div>
              <p className="text-sm text-jericho-muted">{m.blurb}</p>
              <p className="text-xs text-jericho-muted mt-3">Rebuilt from {m.sourceApp}</p>
            </Panel>
          </Link>
        ))}
      </div>
    </>
  );
}
