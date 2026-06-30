import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { createCampaign, listCampaigns } from "@/lib/modules/campaigns/campaigns";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

function statusTone(s: string): string {
  if (s === "active") return "low";
  if (s === "completed") return "medium";
  return "high"; // draft | paused
}

export default async function CampaignsPage() {
  const { orgId } = await requireTenant();
  const list = await listCampaigns(orgId);

  async function create(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const id = await createCampaign(orgId, userId, {
      name: String(formData.get("name") || "Untitled campaign"),
      objective: String(formData.get("objective") || "") || undefined,
    });
    redirect(`/campaigns/${id}`);
  }

  return (
    <>
      <PageHeader title="Campaigns" subtitle="Narrative campaign simulation with personas, policy-gated launch, and audit." />

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">New campaign</h3>
        <form action={create} className="space-y-2">
          <input name="name" placeholder="Campaign name" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <textarea name="objective" placeholder="Objective (what this simulation should achieve)" rows={2} className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
            Create campaign
          </button>
        </form>
      </Panel>

      {list.length === 0 ? (
        <EmptyState title="No campaigns yet">Create one above to open its mission control.</EmptyState>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
              <Panel className="hover:border-jericho-accent transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  <span className="text-xs text-jericho-muted">autonomy: {c.autonomyMode}</span>
                  <span className="ml-auto text-xs text-jericho-muted">updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                </div>
                {c.objective && <p className="text-sm text-jericho-muted mt-1 line-clamp-2">{c.objective}</p>}
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
