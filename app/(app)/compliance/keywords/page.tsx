import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addKeyword, deleteKeyword, listKeywords, setKeywordEnabled } from "@/lib/modules/compliance/scan";
import { getLearnings } from "@/lib/modules/compliance/scoring";
import type { Severity } from "@/lib/platform/feeds";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

// Tenant tuning: custom keyword rules augment the built-in classifier, and the
// learned preference model (from finding votes) tilts the composite score.
export default async function ComplianceKeywordsPage() {
  const { orgId } = await requireTenant();
  const [keywords, learnings] = await Promise.all([listKeywords(orgId), getLearnings(orgId)]);

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const floor = String(formData.get("severityFloor") || "") as Severity | "";
    await addKeyword(orgId, {
      term: String(formData.get("term") || ""),
      category: String(formData.get("category") || "") || undefined,
      severityFloor: floor || undefined,
    });
    revalidatePath("/compliance/keywords");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteKeyword(orgId, String(formData.get("id") || ""));
    revalidatePath("/compliance/keywords");
  }
  async function toggle(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setKeywordEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/compliance/keywords");
  }

  const hasLearnings = learnings.favoredCategories.length > 0 || learnings.favoredFeeds.length > 0;

  return (
    <>
      <PageHeader title="Keywords & tuning" subtitle="Custom keyword rules and what the scanner has learned from your feedback." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Panel className="mb-4">
            <h3 className="font-medium mb-3">Add keyword</h3>
            <form action={add} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <input name="term" placeholder="Term to match" required className="md:col-span-2 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <input name="category" placeholder="Category" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
              <select name="severityFloor" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
                <option value="">No floor</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <div className="md:col-span-4">
                <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                  Add keyword
                </button>
              </div>
            </form>
          </Panel>

          {keywords.length === 0 ? (
            <EmptyState title="No custom keywords">The built-in compliance classifier still applies. Add terms to tune it.</EmptyState>
          ) : (
            <Panel className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-left text-jericho-muted border-b border-jericho-border">
                  <tr>
                    <th className="px-5 py-3 font-medium">Term</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Floor</th>
                    <th className="px-5 py-3 font-medium">Matches</th>
                    <th className="px-5 py-3 font-medium">State</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => (
                    <tr key={k.id} className="border-b border-jericho-border/50 last:border-0">
                      <td className="px-5 py-3 text-jericho-text">{k.term}</td>
                      <td className="px-5 py-3 text-jericho-muted">{k.category ?? "—"}</td>
                      <td className="px-5 py-3 text-jericho-muted">{k.severityFloor ?? "—"}</td>
                      <td className="px-5 py-3 text-jericho-muted">{k.matchCount}</td>
                      <td className="px-5 py-3">
                        <form action={toggle}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="enabled" value={k.enabled ? "0" : "1"} />
                          <button className="text-jericho-accent hover:underline" type="submit">
                            {k.enabled ? "enabled" : "disabled"}
                          </button>
                        </form>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <form action={remove}>
                          <input type="hidden" name="id" value={k.id} />
                          <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                            remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>

        <Panel>
          <h3 className="font-medium mb-1">What the scanner learned</h3>
          <p className="text-xs text-jericho-muted mb-3">From useful / not-useful votes on findings. Higher = favored, negative = down-ranked.</p>
          {!hasLearnings ? (
            <p className="text-sm text-jericho-muted">No feedback yet. Vote on findings to train ranking.</p>
          ) : (
            <div className="space-y-4">
              {learnings.favoredCategories.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-jericho-muted mb-1">Categories</div>
                  <ul className="text-sm space-y-1">
                    {learnings.favoredCategories.map((c) => (
                      <li key={c.name} className="flex justify-between">
                        <span>{c.name}</span>
                        <span className={c.net >= 0 ? "text-jericho-good" : "text-jericho-bad"}>{c.net > 0 ? `+${c.net}` : c.net}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {learnings.favoredFeeds.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-jericho-muted mb-1">Feeds</div>
                  <ul className="text-sm space-y-1">
                    {learnings.favoredFeeds.map((c) => (
                      <li key={c.name} className="flex justify-between">
                        <span>{c.name}</span>
                        <span className={c.net >= 0 ? "text-jericho-good" : "text-jericho-bad"}>{c.net > 0 ? `+${c.net}` : c.net}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
