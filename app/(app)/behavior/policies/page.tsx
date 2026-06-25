import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { acknowledgePolicy, createPolicy, listPolicies, policyStats } from "@/lib/modules/behavior/policies";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

export default async function PolicyCenterPage() {
  const { orgId } = await requireTenant();
  const [list, stats] = await Promise.all([listPolicies(orgId), policyStats(orgId)]);

  async function create(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await createPolicy(orgId, {
      title: String(formData.get("title") || ""),
      category: String(formData.get("category") || "") || undefined,
      content: String(formData.get("content") || "") || undefined,
      version: String(formData.get("version") || "") || undefined,
    });
    revalidatePath("/behavior/policies");
  }

  async function ack(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant();
    await acknowledgePolicy(orgId, String(formData.get("id") || ""), userId);
    revalidatePath("/behavior/policies");
  }

  return (
    <>
      <PageHeader title="Policy Center" subtitle="Publish security policies and track acknowledgments." />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Active policies" value={stats.active} />
        <Stat label="Acknowledgments" value={stats.acknowledgments} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          {list.length === 0 ? (
            <EmptyState title="No policies yet">Create your first policy to start tracking acknowledgments.</EmptyState>
          ) : (
            <div className="space-y-3">
              {list.map((p) => (
                <Panel key={p.id} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {p.title} <span className="text-xs text-jericho-muted">v{p.version}</span>
                    </div>
                    {p.category && <div className="text-xs text-jericho-muted">{p.category}</div>}
                    {p.content && <p className="text-sm text-jericho-muted mt-1 line-clamp-2">{p.content}</p>}
                  </div>
                  <form action={ack}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                      Acknowledge
                    </button>
                  </form>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <Panel>
          <h3 className="font-medium mb-3">New policy</h3>
          <form action={create} className="space-y-2">
            <input name="title" placeholder="Title" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="category" placeholder="Category (optional)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="version" placeholder="Version (e.g. 1.0)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <textarea name="content" placeholder="Policy text" rows={4} className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Publish policy
            </button>
          </form>
          <p className="text-xs text-jericho-muted mt-3">Document file upload lands with platform object storage.</p>
        </Panel>
      </div>
    </>
  );
}
