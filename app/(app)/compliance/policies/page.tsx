import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addPolicy, deletePolicy, listPolicies } from "@/lib/modules/compliance/scan";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

// Compliance policies — the regulatory/control documents the scanner maps
// findings against. Separate from Behavior's Policy Center. Starts empty.
export default async function CompliancePoliciesPage() {
  const { orgId } = await requireTenant();
  const policies = await listPolicies(orgId);

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await addPolicy(orgId, {
      title: String(formData.get("title") || ""),
      reference: String(formData.get("reference") || "") || undefined,
      category: String(formData.get("category") || "") || undefined,
      content: String(formData.get("content") || "") || undefined,
    });
    revalidatePath("/compliance/policies");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deletePolicy(orgId, String(formData.get("id") || ""));
    revalidatePath("/compliance/policies");
  }

  return (
    <>
      <PageHeader title="Policies" subtitle="Your compliance/regulatory policies. Findings are cross-referenced against these. Starts empty — add your own." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          {policies.length === 0 ? (
            <EmptyState title="No policies yet">Add your compliance policies to map findings against them.</EmptyState>
          ) : (
            <div className="space-y-3">
              {policies.map((p) => (
                <Panel key={p.id} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {p.title}
                      {p.reference && <span className="text-xs text-jericho-muted"> · {p.reference}</span>}
                    </div>
                    {p.category && <div className="text-xs text-jericho-muted">{p.category}</div>}
                    {p.content && <p className="text-sm text-jericho-muted mt-1 line-clamp-2">{p.content}</p>}
                  </div>
                  <form action={remove}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-jericho-muted hover:text-jericho-bad text-sm" type="submit">
                      remove
                    </button>
                  </form>
                </Panel>
              ))}
            </div>
          )}
        </div>

        <Panel>
          <h3 className="font-medium mb-3">New policy</h3>
          <form action={add} className="space-y-2">
            <input name="title" placeholder="Title" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="reference" placeholder="Reference / control id" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="category" placeholder="Category (e.g. HIPAA)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <textarea name="content" placeholder="Policy text / summary" rows={4} className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add policy
            </button>
          </form>
          <p className="text-xs text-jericho-muted mt-3">Findings are AI-cross-referenced against these policies on the Findings tab (requires an Anthropic API key).</p>
        </Panel>
      </div>
    </>
  );
}
