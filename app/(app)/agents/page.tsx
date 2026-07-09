import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import {
  addGateway,
  listGateways,
  parseAgentsCache,
  probeAllGateways,
  probeGateway,
  removeGateway,
  updateGatewayToken,
} from "@/lib/modules/agents/gateways";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const STATUS_TONE: Record<string, string> = {
  online: "low",
  pairing_pending: "medium",
  unauthorized: "high",
  unreachable: "high",
  unknown: "unknown",
};

const STATUS_LABEL: Record<string, string> = {
  online: "online",
  pairing_pending: "pairing pending",
  unauthorized: "auth failed",
  unreachable: "unreachable",
  unknown: "not checked",
};

export default async function AgentsFleetPage() {
  const { orgId } = await requireTenant();
  const gateways = await listGateways(orgId);
  const online = gateways.filter((g) => g.status === "online").length;

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const id = await addGateway(orgId, {
      name: String(formData.get("name") || ""),
      url: String(formData.get("url") || ""),
      token: String(formData.get("token") || ""),
    });
    await probeGateway(orgId, id);
    revalidatePath("/agents");
  }

  async function probe(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await probeGateway(orgId, String(formData.get("id") || ""));
    revalidatePath("/agents");
  }

  async function probeAll() {
    "use server";
    const { orgId } = await requireTenant("member");
    await probeAllGateways(orgId);
    revalidatePath("/agents");
  }

  async function remove(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await removeGateway(orgId, String(formData.get("id") || ""));
    revalidatePath("/agents");
  }

  async function setToken(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const id = String(formData.get("id") || "");
    await updateGatewayToken(orgId, id, String(formData.get("token") || ""));
    await probeGateway(orgId, id);
    revalidatePath("/agents");
  }

  return (
    <>
      <PageHeader
        title="Agent fleet"
        subtitle="Connect the OpenClaw gateways running on your devices and work with every agent from one place."
        action={
          gateways.length > 0 ? (
            <form action={probeAll}>
              <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm hover:border-jericho-accent" type="submit">
                Re-check all
              </button>
            </form>
          ) : undefined
        }
      />

      {gateways.length > 0 && (
        <p className="text-sm text-jericho-muted mb-4">
          {online} of {gateways.length} device{gateways.length === 1 ? "" : "s"} online
        </p>
      )}

      <Panel className="mb-6">
        <h3 className="font-medium mb-1">Add a device</h3>
        <p className="text-xs text-jericho-muted mb-3">
          On the device, expose the gateway to this server (e.g. a tailnet address) and copy its auth token
          (<code className="text-jericho-text">gateway.auth.token</code> in the OpenClaw config). First connect shows as{" "}
          <em>pairing pending</em> until you approve this dashboard on the device: <code className="text-jericho-text">openclaw devices approve</code>.
        </p>
        <form action={add} className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2">
          <input name="name" placeholder="Device name (e.g. MacBook)" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="url" placeholder="ws://device:18789" required className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <input name="token" type="password" placeholder="Gateway token" className="rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent" />
          <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
            Connect
          </button>
        </form>
      </Panel>

      {gateways.length === 0 ? (
        <EmptyState title="No devices connected yet">
          Add the OpenClaw gateway from each of your devices above — then chat with any of them, or broadcast one task to all of them.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gateways.map((g) => {
            const cache = parseAgentsCache(g.agentsJson);
            return (
              <Panel key={g.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status] ?? g.status}</Badge>
                  <span className="ml-auto text-xs text-jericho-muted">
                    {g.lastProbeAt ? `checked ${new Date(g.lastProbeAt).toLocaleTimeString()}` : "never checked"}
                  </span>
                </div>
                <div className="text-xs text-jericho-muted font-mono">{g.url}</div>

                {g.status === "pairing_pending" && (
                  <div className="rounded-lg border border-jericho-warn/40 bg-jericho-warn/10 px-3 py-2 text-xs text-jericho-text">
                    This dashboard is waiting to be approved on the device. Run{" "}
                    <code>openclaw devices approve</code> (or use the Control UI) on {g.name}, then re-check.
                  </div>
                )}
                {g.status !== "online" && g.status !== "pairing_pending" && g.statusDetail && (
                  <div className="text-xs text-jericho-bad line-clamp-2">{g.statusDetail}</div>
                )}

                {cache.agents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {cache.agents.map((a) => (
                      <span key={a.id} className="rounded-full border border-jericho-border px-2.5 py-0.5 text-xs text-jericho-muted">
                        {a.emoji ? `${a.emoji} ` : ""}
                        {a.name ?? a.id}
                        {a.id === cache.defaultId ? " · default" : ""}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <Link
                    href={`/agents/${g.id}`}
                    className="rounded-lg bg-jericho-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    Open chat
                  </Link>
                  <form action={probe}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="rounded-lg border border-jericho-border px-3 py-1.5 text-sm hover:border-jericho-accent" type="submit">
                      Re-check
                    </button>
                  </form>
                  <form action={remove} className="ml-auto">
                    <input type="hidden" name="id" value={g.id} />
                    <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
                      Remove
                    </button>
                  </form>
                </div>

                {(g.status === "unauthorized" || g.status === "unknown") && (
                  <form action={setToken} className="flex gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <input
                      name="token"
                      type="password"
                      placeholder="Update gateway token"
                      className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-1.5 text-xs outline-none focus:border-jericho-accent"
                    />
                    <button className="rounded-lg border border-jericho-border px-3 py-1.5 text-xs hover:border-jericho-accent" type="submit">
                      Save
                    </button>
                  </form>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
