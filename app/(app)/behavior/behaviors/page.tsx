import { requireTenant } from "@/lib/platform/org";
import { listBehaviors } from "@/lib/modules/behavior/risk";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function BehaviorsPage() {
  const { orgId } = await requireTenant();
  const rows = await listBehaviors(orgId);

  return (
    <>
      <PageHeader title="Behaviors" subtitle="Detected risk behaviors across monitored people." />
      {rows.length === 0 ? (
        <EmptyState title="No behaviors recorded">
          Behaviors arrive from campaign results, email triage, and SIEM signals via the data-source sync.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <Panel key={b.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.personName}</span>
                  <Badge tone={b.severity === "low" ? "low" : b.severity === "medium" ? "medium" : "high"}>
                    {b.severity}
                  </Badge>
                  {b.resolved && <span className="text-xs text-jericho-good">resolved</span>}
                </div>
                <div className="text-sm text-jericho-muted mt-1">{b.description ?? b.behaviorType}</div>
              </div>
              <div className="text-xs text-jericho-muted whitespace-nowrap">
                {new Date(b.detectedAt).toLocaleDateString()}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
