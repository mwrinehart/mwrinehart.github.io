import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addFeed, deleteFeed, listFeeds, setFeedEnabled } from "@/lib/modules/compliance/scan";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : "never";
}

export default async function ComplianceFeedsPage() {
  const { orgId } = await requireTenant();
  const feeds = await listFeeds(orgId);

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await addFeed(orgId, {
      name: String(formData.get("name") || ""),
      url: String(formData.get("url") || ""),
      category: String(formData.get("category") || "") || undefined,
    });
    revalidatePath("/compliance/feeds");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await deleteFeed(orgId, String(formData.get("id") || ""));
    revalidatePath("/compliance/feeds");
  }
  async function toggle(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setFeedEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/compliance/feeds");
  }

  return (
    <>
      <PageHeader title="Feeds" subtitle="Regulatory and threat-intelligence sources this organization scans. Starts empty — add your own." />

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Add a feed</h3>
        <form action={add} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <input name="name" placeholder="Name (e.g. CISA Alerts)" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="url" placeholder="https://…/rss" required className="md:col-span-2 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="category" placeholder="Category (optional)" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <div className="md:col-span-4">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add feed
            </button>
          </div>
        </form>
      </Panel>

      {feeds.length === 0 ? (
        <EmptyState title="No feeds yet">Add a regulatory or threat feed above to start scanning.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Feed</th>
                <th className="px-5 py-3 font-medium">Last scan</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="text-jericho-text">{f.name}</div>
                    <div className="text-xs text-jericho-muted truncate max-w-md">{f.url}</div>
                    {f.lastError && <div className="text-xs text-jericho-bad mt-0.5">{f.lastError}</div>}
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{fmt(f.lastScannedAt)}</td>
                  <td className="px-5 py-3">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="enabled" value={f.enabled ? "0" : "1"} />
                      <button className="text-jericho-accent hover:underline" type="submit">
                        {f.enabled ? "enabled" : "disabled"}
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={remove}>
                      <input type="hidden" name="id" value={f.id} />
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
    </>
  );
}
