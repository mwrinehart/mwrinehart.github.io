import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { listCampaigns } from "@/lib/modules/campaigns/campaigns";
import { decideApproval, listPendingApprovals } from "@/lib/modules/campaigns/approvals";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function ApprovalsPage() {
  const { orgId, role } = await requireTenant();
  const [pending, campaignList] = await Promise.all([listPendingApprovals(orgId), listCampaigns(orgId)]);
  const names = new Map(campaignList.map((c) => [c.id, c.name]));
  const canDecide = role === "admin" || role === "owner";

  async function decide(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("admin");
    const decision = String(formData.get("decision") || "") === "approved" ? "approved" : "rejected";
    await decideApproval(orgId, userId, String(formData.get("id") || ""), decision, String(formData.get("note") || "") || undefined);
    revalidatePath("/campaigns/approvals");
  }

  return (
    <>
      <PageHeader title="Approvals" subtitle="Pending launch, expansion, and content sign-offs across campaigns." />

      {!canDecide && (
        <p className="mb-4 text-xs text-jericho-muted">You can view pending approvals; deciding requires an admin or owner role.</p>
      )}

      {pending.length === 0 ? (
        <EmptyState title="No pending approvals">Requests made from a campaign's mission control appear here.</EmptyState>
      ) : (
        <div className="space-y-3">
          {pending.map((a) => (
            <Panel key={a.id}>
              <div className="flex items-center gap-2">
                <Badge tone={a.riskScore >= 60 ? "high" : a.riskScore >= 30 ? "medium" : "low"}>risk {a.riskScore}</Badge>
                <span className="text-xs text-jericho-muted">{a.type}</span>
                <Link href={`/campaigns/${a.campaignId}`} className="ml-auto text-xs text-jericho-accent hover:underline">
                  {names.get(a.campaignId) ?? "campaign"}
                </Link>
              </div>
              <div className="font-medium mt-1">{a.title}</div>
              {a.detail && <p className="text-sm text-jericho-muted mt-1">{a.detail}</p>}
              {canDecide && (
                <form action={decide} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="note" placeholder="Decision note (optional)" className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
                  <button name="decision" value="approved" className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                    Approve
                  </button>
                  <button name="decision" value="rejected" className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-bad hover:bg-jericho-border/40" type="submit">
                    Reject
                  </button>
                </form>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
