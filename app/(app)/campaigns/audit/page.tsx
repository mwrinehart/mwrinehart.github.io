import Link from "next/link";
import { requireTenant } from "@/lib/platform/org";
import { listCampaigns } from "@/lib/modules/campaigns/campaigns";
import { listAudit } from "@/lib/modules/campaigns/audit";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

// Immutable, actor-aware audit trail across all campaigns in the org.
export default async function CampaignAuditPage() {
  const { orgId } = await requireTenant();
  const [entries, campaignList] = await Promise.all([listAudit(orgId), listCampaigns(orgId)]);
  const names = new Map(campaignList.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every campaign action, by actor." />
      {entries.length === 0 ? (
        <EmptyState title="No activity yet">Campaign actions are recorded here as they happen.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-2.5 text-jericho-muted whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-2.5">
                    <span className="text-jericho-text">{e.action}</span>
                    {e.detail && <span className="text-jericho-muted"> · {e.detail}</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    {e.campaignId ? (
                      <Link href={`/campaigns/${e.campaignId}`} className="text-jericho-accent hover:underline">
                        {names.get(e.campaignId) ?? "campaign"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-jericho-muted">{e.actorUserId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
