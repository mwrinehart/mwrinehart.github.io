import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { addRoute, deleteRoute, listAlerts, listRoutes, setAlertStatus, setRouteEnabled } from "@/lib/modules/narrative/alerts";
import { listNarratives } from "@/lib/modules/narrative/scan";
import type { Severity } from "@/lib/platform/feeds";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

// Narrative alerts — the in-app queue of escalations (a narrative crossing the
// threat threshold), plus the channel routes that fan alerts out to
// Slack/Teams/email via the platform notifier.
export default async function NarrativeAlertsPage() {
  const { orgId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";
  const [alerts, routes, narratives] = await Promise.all([listAlerts(orgId), listRoutes(orgId), listNarratives(orgId, 200)]);
  const narrativeTitles = new Map(narratives.map((n) => [n.id, n.title]));
  // Open alerts first, then acknowledged/resolved (each group stays newest-first).
  const ordered = [...alerts.filter((a) => a.status === "open"), ...alerts.filter((a) => a.status !== "open")];

  async function updateAlert(formData: FormData) {
    "use server";
    const { orgId, userId } = await requireTenant("member");
    const status = String(formData.get("status") || "");
    if (status !== "acknowledged" && status !== "resolved") return;
    await setAlertStatus(orgId, userId, String(formData.get("id") || ""), status);
    revalidatePath("/narrative/alerts");
  }
  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const severityMin = String(formData.get("severityMin") || "high");
    const provider = String(formData.get("channelProvider") || "slack");
    await addRoute(orgId, {
      name: String(formData.get("name") || ""),
      severityMin: SEVERITIES.includes(severityMin as Severity) ? (severityMin as Severity) : "high",
      channelProvider: provider === "teams" ? "teams" : provider === "email" ? "email" : "slack",
      channelTarget: String(formData.get("channelTarget") || ""),
    });
    revalidatePath("/narrative/alerts");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await deleteRoute(orgId, String(formData.get("id") || ""));
    revalidatePath("/narrative/alerts");
  }
  async function toggle(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await setRouteEnabled(orgId, String(formData.get("id") || ""), formData.get("enabled") === "1");
    revalidatePath("/narrative/alerts");
  }

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Escalations raised when a narrative crosses the threat threshold, and the channel routes that push them to Slack, Teams, or email."
      />

      <h3 className="font-medium mb-3">Alert queue</h3>
      {ordered.length === 0 ? (
        <EmptyState title="No alerts">Alerts appear when a false narrative crosses the threat threshold.</EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {ordered.map((a) => (
            <Panel key={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.severity}>{a.severity}</Badge>
                <span className="font-medium text-jericho-text">{a.title}</span>
                <span className="ml-auto text-xs text-jericho-muted">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              {a.body && <p className="mt-2 whitespace-pre-wrap text-sm text-jericho-muted">{a.body}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <Link href={`/narrative/${a.narrativeId}`} className="text-jericho-accent hover:underline">
                  {narrativeTitles.get(a.narrativeId) ?? "View narrative"}
                </Link>
                <span className="text-jericho-muted">status: {a.status}</span>
                {a.status === "open" && (
                  <form action={updateAlert}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value="acknowledged" />
                    <button className="text-jericho-accent hover:underline" type="submit">
                      Acknowledge
                    </button>
                  </form>
                )}
                {(a.status === "open" || a.status === "acknowledged") && (
                  <form action={updateAlert}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value="resolved" />
                    <button className="text-jericho-accent hover:underline" type="submit">
                      Resolve
                    </button>
                  </form>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <h3 className="font-medium mb-3 mt-6">Channel routes</h3>
      {isAdmin ? (
        <Panel className="mb-6">
          <h4 className="font-medium mb-3">New alert route</h4>
          <form action={add} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <input
              name="name"
              placeholder="Route name"
              required
              className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <select
              name="severityMin"
              defaultValue="high"
              className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            >
              <option value="low">&ge; low</option>
              <option value="medium">&ge; medium</option>
              <option value="high">&ge; high</option>
              <option value="critical">&ge; critical</option>
            </select>
            <select
              name="channelProvider"
              className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            >
              <option value="slack">Slack</option>
              <option value="teams">Teams</option>
              <option value="email">Email</option>
            </select>
            <input
              name="channelTarget"
              placeholder="Channel / webhook / email"
              required
              className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <div className="md:col-span-4">
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Add route
              </button>
              <span className="text-xs text-jericho-muted ml-3">
                Targets: Slack channel id (bot token) or webhook URL &middot; Teams webhook URL &middot; email recipient. Configure
                credentials in org secrets.
              </span>
            </div>
          </form>
        </Panel>
      ) : (
        <p className="text-xs text-jericho-muted mb-6">Only org admins can add or change alert routes.</p>
      )}

      {routes.length === 0 ? (
        <EmptyState title="No alert routes">Add a route to push narrative alerts to your channels.</EmptyState>
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
                    <Badge tone={r.severityMin}>&ge; {r.severityMin}</Badge>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">
                    {r.channelProvider} &middot; <span className="truncate">{r.channelTarget}</span>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">
                    {r.sentCount} &middot; {r.lastSentAt ? new Date(r.lastSentAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {isAdmin ? (
                      <form action={toggle}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                        <button className="text-jericho-accent hover:underline" type="submit">
                          {r.enabled ? "enabled" : "disabled"}
                        </button>
                      </form>
                    ) : (
                      <span className="text-jericho-muted">{r.enabled ? "enabled" : "disabled"}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {isAdmin && (
                      <form action={remove}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                          remove
                        </button>
                      </form>
                    )}
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
