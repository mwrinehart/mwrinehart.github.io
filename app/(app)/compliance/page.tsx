import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { listFeeds, listFindings, scanOrgComplianceFeeds } from "@/lib/modules/compliance/scan";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// Compliance Radar — findings. Tenants configure their own feeds (Feeds tab) and
// policies (Policies tab); both start empty.
export default async function ComplianceFindingsPage() {
  const { orgId } = await requireTenant();
  const [feeds, findings] = await Promise.all([listFeeds(orgId), listFindings(orgId)]);
  const hasFeeds = feeds.some((f) => f.enabled);

  async function scan() {
    "use server";
    const { orgId } = await requireTenant("member");
    await scanOrgComplianceFeeds(orgId);
    revalidatePath("/compliance");
  }

  return (
    <>
      <PageHeader
        title="Compliance Radar"
        subtitle="Regulatory & threat findings from your configured feeds, classified by severity and category."
        action={
          hasFeeds ? (
            <form action={scan}>
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Scan now
              </button>
            </form>
          ) : undefined
        }
      />

      {findings.length === 0 ? (
        <EmptyState title={hasFeeds ? "No findings yet" : "No feeds configured"}>
          {hasFeeds ? (
            <>Click “Scan now”, or wait for the scheduled <code>compliance-scan</code> job.</>
          ) : (
            <>
              Add regulatory or threat feeds on the{" "}
              <Link href="/compliance/feeds" className="text-jericho-accent hover:underline">
                Feeds
              </Link>{" "}
              tab to start scanning.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <Panel key={f.id}>
              <div className="flex items-center gap-2">
                <Badge tone={f.severity === "low" ? "low" : f.severity === "medium" ? "medium" : "high"}>{f.severity}</Badge>
                {f.category && <span className="text-xs text-jericho-muted">{f.category}</span>}
                <span className="ml-auto text-xs text-jericho-muted">{f.feedName}</span>
              </div>
              <a href={f.link ?? "#"} target="_blank" rel="noreferrer" className="block font-medium mt-1 hover:text-jericho-accent">
                {f.title}
              </a>
              {f.summary && <p className="text-sm text-jericho-muted mt-1 line-clamp-2">{f.summary}</p>}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
