import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { createNudgeConfig, listNudgeConfigs, listNudgeEvents, sendNudge } from "@/lib/modules/behavior/nudges";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export default async function NudgesPage() {
  const { orgId } = await requireTenant();
  const [configs, events] = await Promise.all([listNudgeConfigs(orgId), listNudgeEvents(orgId)]);

  async function createAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const channels = (["device", "slack", "teams"] as const).filter((c) => formData.get(`ch_${c}`));
    await createNudgeConfig(orgId, {
      title: String(formData.get("title") || ""),
      message: String(formData.get("message") || ""),
      deliveryChannels: channels.join(",") || "device",
      slackChannel: String(formData.get("slackChannel") || "") || undefined,
      teamsWebhookId: String(formData.get("teamsWebhookId") || "") || undefined,
    });
    revalidatePath("/behavior/nudges");
  }

  async function sendAction(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await sendNudge(orgId, String(formData.get("id") || ""));
    revalidatePath("/behavior/nudges");
  }

  return (
    <>
      <PageHeader title="Nudges" subtitle="Security reminders delivered to people's devices, Slack, or Teams." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Panel>
          <h3 className="font-medium mb-3">Nudges</h3>
          {configs.length === 0 ? (
            <p className="text-sm text-jericho-muted">No nudges yet. Create one to start.</p>
          ) : (
            <ul className="space-y-3">
              {configs.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-jericho-text">{n.title}</div>
                    <div className="text-xs text-jericho-muted">{n.message}</div>
                    <div className="text-[11px] text-jericho-muted mt-1">channels: {n.deliveryChannels}</div>
                  </div>
                  <form action={sendAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="rounded-lg border border-jericho-border px-2.5 py-1 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                      Send
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h3 className="font-medium mb-3">New nudge</h3>
          <form action={createAction} className="space-y-2">
            <input name="title" placeholder="Title" required className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <textarea name="message" placeholder="Message" required rows={3} className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <div className="flex gap-4 text-sm text-jericho-muted">
              <label className="flex items-center gap-1.5"><input type="checkbox" name="ch_device" defaultChecked /> Device</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="ch_slack" /> Slack</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="ch_teams" /> Teams</label>
            </div>
            <input name="slackChannel" placeholder="Slack channel id (optional)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <input name="teamsWebhookId" placeholder="Teams webhook URL (optional)" className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Create nudge
            </button>
          </form>
        </Panel>
      </div>

      <h3 className="text-sm uppercase tracking-wide text-jericho-muted mb-3">Delivery log</h3>
      {events.length === 0 ? (
        <EmptyState title="No deliveries yet">Send a nudge to see its delivery events here.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Nudge</th>
                <th className="px-5 py-3 font-medium">Channel</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">{e.title}</td>
                  <td className="px-5 py-3 text-jericho-muted">{e.deliveryChannel}</td>
                  <td className="px-5 py-3">
                    <Badge tone={e.status === "sent" ? "low" : e.status === "failed" ? "high" : "medium"}>{e.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
