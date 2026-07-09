import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireTenant } from "@/lib/platform/org";
import { listGateways } from "@/lib/modules/agents/gateways";
import { executeChatTurn, isRunActive, listBroadcasts, startBroadcast } from "@/lib/modules/agents/chat";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

// One prompt, every device: fan a task out to selected gateways and compare the
// replies side by side. This is the "get work done across the fleet" surface.
export default async function BroadcastPage() {
  const { orgId } = await requireTenant();
  const [gateways, broadcasts] = await Promise.all([listGateways(orgId), listBroadcasts(orgId, 5)]);
  const gatewayName = new Map(gateways.map((g) => [g.id, g.name]));
  const active = broadcasts.some((b) => b.replies.some(isRunActive));

  async function send(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const text = String(formData.get("text") || "").trim();
    const ids = formData.getAll("gatewayId").map(String).filter(Boolean);
    if (text && ids.length > 0) {
      const { turns } = await startBroadcast(orgId, ids, text);
      after(() => Promise.all(turns.map((t) => executeChatTurn(orgId, t, text))));
    }
    revalidatePath("/agents/broadcast");
  }

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title="Broadcast"
        subtitle="Send one prompt to several devices at once and compare what each agent comes back with."
      />

      {gateways.length === 0 ? (
        <EmptyState title="No devices connected">Add your OpenClaw gateways on the Fleet tab first.</EmptyState>
      ) : (
        <Panel className="mb-6">
          <form action={send} className="space-y-3">
            <textarea
              name="text"
              rows={3}
              required
              placeholder="The task or question for every selected agent…"
              className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
            />
            <div className="flex flex-wrap items-center gap-4">
              {gateways.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="gatewayId"
                    value={g.id}
                    defaultChecked={g.status === "online"}
                    className="accent-jericho-accent"
                  />
                  <span>{g.name}</span>
                  <span className={`text-xs ${g.status === "online" ? "text-jericho-good" : "text-jericho-muted"}`}>
                    {g.status === "online" ? "online" : g.status.replace("_", " ")}
                  </span>
                </label>
              ))}
              <button
                className="ml-auto rounded-lg bg-jericho-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                type="submit"
              >
                Send to selected
              </button>
            </div>
          </form>
        </Panel>
      )}

      {broadcasts.map((b) => (
        <Panel key={b.broadcastId} className="mb-4">
          <div className="flex items-baseline gap-2 mb-3">
            <p className="text-sm font-medium whitespace-pre-wrap">{b.prompt}</p>
            <span className="ml-auto shrink-0 text-xs text-jericho-muted">{new Date(b.sentAt).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {b.replies.map((r) => (
              <div key={r.id} className="rounded-lg border border-jericho-border bg-jericho-bg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">{gatewayName.get(r.gatewayId) ?? "Removed device"}</span>
                  <Badge
                    tone={r.status === "final" ? "low" : r.status === "error" ? "high" : "medium"}
                  >
                    {r.status === "pending" || r.status === "streaming" ? "working" : r.status}
                  </Badge>
                </div>
                <div className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                  {r.content || (r.status === "error" ? null : <span className="text-jericho-muted animate-pulse">thinking…</span>)}
                </div>
                {r.status === "error" && <div className="text-xs text-jericho-bad mt-1">{r.error}</div>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </>
  );
}
