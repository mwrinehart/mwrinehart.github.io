import Link from "next/link";
import { requireTenant } from "@/lib/platform/org";
import { getModule } from "@/lib/platform/modules";
import { riskOverview } from "@/lib/modules/behavior/risk";
import { complianceOverview } from "@/lib/modules/compliance/scan";
import { campaignsOverview } from "@/lib/modules/campaigns/campaigns";
import { pendingApprovalCount } from "@/lib/modules/campaigns/approvals";
import { studioOverview } from "@/lib/modules/studio/projects";
import { agentsOverview } from "@/lib/modules/agents/gateways";
import { PageHeader, Panel } from "@/components/ui";

// The unified landing page: one live overview across every module — the thing
// none of the four source apps could show on its own. Each module card links into
// the module; the "needs attention" strip surfaces the actionable counts.
export default async function DashboardPage() {
  const { orgId, role } = await requireTenant();
  const [behavior, compliance, campaigns, pendingApprovals, studio, agents] = await Promise.all([
    riskOverview(orgId),
    complianceOverview(orgId),
    campaignsOverview(orgId),
    pendingApprovalCount(orgId),
    studioOverview(orgId),
    agentsOverview(orgId),
  ]);

  const atRisk = behavior.bands.high + behavior.bands.critical;
  const attention = [
    pendingApprovals > 0 && { href: "/campaigns/approvals", label: "Campaign approvals waiting", count: pendingApprovals },
    compliance.unanalyzed > 0 && { href: "/compliance", label: "Findings to analyze", count: compliance.unanalyzed },
    compliance.critical > 0 && { href: "/compliance", label: "Critical compliance findings", count: compliance.critical },
    atRisk > 0 && { href: "/behavior/risk", label: "High / critical-risk people", count: atRisk },
  ].filter(Boolean) as Array<{ href: string; label: string; count: number }>;

  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="One workspace for human-risk, compliance, content, and campaign simulation."
        action={<span className="text-xs text-jericho-muted self-center">role: {role}</span>}
      />

      {attention.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Needs attention</h2>
          <div className="flex flex-wrap gap-3">
            {attention.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-2 rounded-lg border border-jericho-border bg-jericho-panel px-4 py-2 text-sm hover:border-jericho-accent transition-colors"
              >
                <span className="text-lg font-semibold text-jericho-warn">{a.count}</span>
                <span className="text-jericho-muted">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Modules</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ModuleCard
          id="behavior"
          stats={[
            { label: "People", value: behavior.peopleCount },
            { label: "Avg risk", value: behavior.avgRisk },
            { label: "High/crit", value: atRisk },
          ]}
        />
        <ModuleCard
          id="compliance"
          stats={[
            { label: "Findings", value: compliance.findings },
            { label: "Critical", value: compliance.critical },
            { label: "To analyze", value: compliance.unanalyzed },
          ]}
        />
        <ModuleCard
          id="campaigns"
          stats={[
            { label: "Campaigns", value: campaigns.total },
            { label: "Active", value: campaigns.active },
            { label: "Approvals", value: pendingApprovals },
          ]}
        />
        <ModuleCard
          id="studio"
          stats={[
            { label: "Courses", value: studio.total },
            { label: "Published", value: studio.published },
          ]}
        />
        <ModuleCard
          id="agents"
          stats={[
            { label: "Devices", value: agents.devices },
            { label: "Online", value: agents.online },
          ]}
        />
      </div>
    </>
  );
}

function ModuleCard({ id, stats }: { id: string; stats: Array<{ label: string; value: number }> }) {
  const m = getModule(id);
  if (!m) return null;
  return (
    <Link href={m.href} className="block">
      <Panel className="hover:border-jericho-accent transition-colors h-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl" aria-hidden>
            {m.icon}
          </span>
          <span className="font-medium">{m.label}</span>
          <span className={`ml-auto text-[10px] uppercase tracking-wide ${m.status === "live" ? "text-jericho-good" : "text-jericho-muted"}`}>
            {m.status}
          </span>
        </div>
        <p className="text-sm text-jericho-muted">{m.blurb}</p>
        <div className="flex gap-6 mt-4">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-semibold text-jericho-text">{s.value}</div>
              <div className="text-xs text-jericho-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </Panel>
    </Link>
  );
}
