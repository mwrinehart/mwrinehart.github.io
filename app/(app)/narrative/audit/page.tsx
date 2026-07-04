import Link from "next/link";
import { requireTenant } from "@/lib/platform/org";
import { listAudit } from "@/lib/modules/narrative/audit";
import { listNarratives } from "@/lib/modules/narrative/scan";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

// Append-only audit trail for the Narrative module: every detection, verdict,
// alert, and counter-response decision, by actor (null actor = system/cron).
export default async function NarrativeAuditPage() {
  const { orgId } = await requireTenant();
  const [entries, narrativeList] = await Promise.all([listAudit(orgId), listNarratives(orgId)]);
  const titles = new Map(narrativeList.map((n) => [n.id, n.title]));

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every narrative action — detections, verdicts, alerts, and response decisions — by actor." />
      {entries.length === 0 ? (
        <EmptyState title="No activity yet">Narrative actions are recorded here as they happen.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Narrative</th>
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-2.5 text-jericho-muted whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-2.5">
                    <span className="font-mono text-xs text-jericho-text">{e.action}</span>
                  </td>
                  <td className="px-5 py-2.5">
                    {e.narrativeId ? (
                      <Link href={`/narrative/${e.narrativeId}`} className="text-jericho-accent hover:underline">
                        {titles.get(e.narrativeId) ?? "narrative"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-jericho-muted">{e.actorUserId ?? "system"}</td>
                  <td className="px-5 py-2.5 text-jericho-muted">{e.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
