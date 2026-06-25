import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addMaturityControl, createMaturityFramework, listMaturity, listMaturityControls, snapshotMaturity, updateMaturityControl } from "@/lib/modules/behavior/grc";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function MaturityPage() {
  const { orgId } = await requireTenant();
  const [rollups, controls] = await Promise.all([listMaturity(orgId), listMaturityControls(orgId)]);

  async function createFw(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await createMaturityFramework(orgId, { name: String(formData.get("name") || "") });
    revalidatePath("/behavior/maturity");
  }
  async function addControl(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await addMaturityControl(orgId, {
      frameworkId: String(formData.get("frameworkId") || ""),
      domain: String(formData.get("domain") || "") || undefined,
      name: String(formData.get("name") || ""),
    });
    revalidatePath("/behavior/maturity");
  }
  async function scoreControl(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await updateMaturityControl(orgId, String(formData.get("id") || ""), { score: Number(formData.get("score") || 0) });
    revalidatePath("/behavior/maturity");
  }
  async function snapshot(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await snapshotMaturity(orgId, String(formData.get("frameworkId") || ""));
    revalidatePath("/behavior/maturity");
  }

  return (
    <>
      <PageHeader
        title="Program maturity"
        subtitle="Assess control maturity (0–5) by domain and snapshot the average over time."
        action={
          <form action={createFw} className="flex gap-2">
            <input name="name" placeholder="New framework (e.g. NIST CSF)" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">Add</button>
          </form>
        }
      />

      {rollups.length === 0 ? (
        <EmptyState title="No maturity frameworks yet">Add a framework, then add controls and score them 0–5.</EmptyState>
      ) : (
        <div className="space-y-4">
          {rollups.map((fw) => {
            const own = controls.filter((c) => c.frameworkId === fw.id);
            return (
              <Panel key={fw.id}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="font-medium">{fw.name}</span>
                    <span className="text-sm text-jericho-muted"> · avg {fw.avgScore}/5 · {fw.scored}/{fw.total} scored</span>
                  </div>
                  <form action={snapshot}>
                    <input type="hidden" name="frameworkId" value={fw.id} />
                    <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                      Snapshot
                    </button>
                  </form>
                </div>

                <ul className="space-y-2 mb-3">
                  {own.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm">
                      <span>
                        {c.domain && <span className="text-jericho-muted">{c.domain} · </span>}
                        {c.name}
                      </span>
                      <form action={scoreControl} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <select name="score" defaultValue={c.score ?? ""} className="rounded border border-jericho-border bg-jericho-bg px-2 py-1 text-sm outline-none">
                          <option value="">—</option>
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <button className="text-jericho-accent hover:underline" type="submit">save</button>
                      </form>
                    </li>
                  ))}
                  {own.length === 0 && <li className="text-sm text-jericho-muted">No controls yet.</li>}
                </ul>

                <form action={addControl} className="flex gap-2">
                  <input type="hidden" name="frameworkId" value={fw.id} />
                  <input name="domain" placeholder="Domain" className="w-32 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
                  <input name="name" placeholder="Control name" required className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
                  <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">Add control</button>
                </form>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
