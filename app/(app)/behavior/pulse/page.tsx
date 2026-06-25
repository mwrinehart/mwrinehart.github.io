import { requireTenant } from "@/lib/platform/org";
import { listPulseFindings } from "@/lib/modules/behavior/risk";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// Threat Pulse — consumes the shared feed engine (lib/platform/feeds.ts). The
// Compliance module (Horizon) uses the same engine, so this view and Compliance's
// findings share scanning + classification code.
export default async function PulsePage() {
  const { orgId } = await requireTenant();
  const findings = await listPulseFindings(orgId);

  return (
    <>
      <PageHeader
        title="Threat Pulse"
        subtitle="Security & regulatory findings from curated feeds, classified by the shared platform feed engine."
      />
      {findings.length === 0 ? (
        <EmptyState title="No findings yet">
          Add feeds and the scheduled scanner surfaces classified findings here; critical items auto-route to Slack/Teams.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <Panel key={f.id}>
              <div className="flex items-center gap-2">
                <Badge tone={f.severity === "low" ? "low" : f.severity === "medium" ? "medium" : "high"}>
                  {f.severity}
                </Badge>
                {f.category && <span className="text-xs text-jericho-muted">{f.category}</span>}
                <span className="ml-auto text-xs text-jericho-muted">{f.feedName}</span>
              </div>
              <a
                href={f.link ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block font-medium mt-1 hover:text-jericho-accent"
              >
                {f.title}
              </a>
              {f.summary && <p className="text-sm text-jericho-muted mt-1">{f.summary}</p>}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
