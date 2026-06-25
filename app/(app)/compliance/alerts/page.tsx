import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addAutoRoute, deleteAutoRoute, listAutoRoutes, setAutoRouteEnabled } from "@/lib/modules/compliance/scan";
import type { Severity } from "@/lib/platform/feeds";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// Instant alert routes — when a scan surfaces a new finding at/above the chosen
// severity (and matching category), it's pushed to Slack/Teams/email via the
// unified notifier. Channel credentials come from the org's encrypted secrets.
export default async function ComplianceAlertsPage() {
  const { orgId } = await requireTenant();
  const routes = await listAutoRoutes(orgId);

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const provider = String(formData.get("channelProvider") || "slack");
    await addAutoRoute(orgId, {
      name: String(formData.get("name") || ""),
      severityMin: (String(formData.get("severityMin") || "high") as Severity) || "high",
      channelProvider: provider === "teams" ? "teams" : provider === "email" ? "email" : "slack",
      channelTarget: String(formData.get("channelTarget") || ""),
      categories: String(formData.get("categories") || "") || undefined,
    });
    revalidatePath("/compliance/alerts");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await deleteAutoRoute(orgId, String(formData.get("id") || ""));
    revalidatePath("/compliance/alerts");
  }
  async function toggle(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await setAutoRouteEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/compliance/alerts");
  }

  return (
    <>
      <PageHeader title="Alerts" subtitle="Route new findings to Slack, Teams, or email by severity and category." />

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">New alert route</h3>
        <form action={add} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <input name="name" placeholder="Route name" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <select name="severityMin" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            <option value="medium">≥ medium</option>
            <option value="high">≥ high</option>
            <option value="critical">≥ critical</option>
          </select>
          <select name="channelProvider" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent">
            <option value="slack">Slack</option>
            <option value="teams">Teams</option>
            <option value="email">Email</option>
          </select>
          <input name="channelTarget" placeholder="Channel / webhook / email" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="categories" placeholder="Categories csv (optional)" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <div className="md:col-span-5">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add route
            </button>
            <span className="text-xs text-jericho-muted ml-3">
              Targets: Slack channel id (bot token) or webhook URL · Teams webhook URL · email recipient. Configure
              credentials in org secrets.
            </span>
          </div>
        </form>
      </Panel>

      {routes.length === 0 ? (
        <EmptyState title="No alert routes">Add a route to start pushing findings to your channels.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Route</th>
                <th className="px-5 py-3 font-medium">Trigger</th>
                <th className="px-5 py-3 font-medium">Channel</th>
                <th className="px-5 py-3 font-medium">Sent</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">{r.name}</td>
                  <td className="px-5 py-3">
                    <Badge tone={r.severityMin === "medium" ? "medium" : "high"}>≥ {r.severityMin}</Badge>
                    {r.categories && <span className="text-xs text-jericho-muted ml-2">{r.categories}</span>}
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">
                    {r.channelProvider} · <span className="truncate">{r.channelTarget}</span>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{r.sentCount}</td>
                  <td className="px-5 py-3">
                    <form action={toggle}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                      <button className="text-jericho-accent hover:underline" type="submit">
                        {r.enabled ? "enabled" : "disabled"}
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={remove}>
                      <input type="hidden" name="id" value={r.id} />
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
