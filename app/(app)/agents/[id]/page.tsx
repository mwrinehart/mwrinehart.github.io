import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireTenant } from "@/lib/platform/org";
import { getGateway, gatewaySessionKey, parseAgentsCache, probeGateway } from "@/lib/modules/agents/gateways";
import { anyActive, clearSession, executeChatTurn, listMessages, startChatTurn } from "@/lib/modules/agents/chat";
import type { AgentChatMessageRow } from "@/lib/modules/agents/schema";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Badge, PageHeader, Panel } from "@/components/ui";

export default async function AgentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const [{ id }, { agent }] = await Promise.all([params, searchParams]);
  const { orgId } = await requireTenant();
  const gateway = await getGateway(orgId, id);
  if (!gateway) notFound();

  const cache = parseAgentsCache(gateway.agentsJson);
  const sessionKey = gatewaySessionKey(gateway, agent);
  const messages = await listMessages(orgId, id, sessionKey);
  const active = anyActive(messages);

  async function send(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const text = String(formData.get("text") || "").trim();
    const agentId = String(formData.get("agentId") || "") || null;
    if (text) {
      try {
        const turn = await startChatTurn(orgId, id, { text, agentId });
        after(() => executeChatTurn(orgId, turn, text));
      } catch {
        // A run is already active in this session; the transcript shows it.
      }
    }
    revalidatePath(`/agents/${id}`);
  }

  async function clear(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await clearSession(orgId, id, String(formData.get("sessionKey") || ""));
    revalidatePath(`/agents/${id}`);
  }

  async function recheck() {
    "use server";
    const { orgId } = await requireTenant("member");
    await probeGateway(orgId, id);
    revalidatePath(`/agents/${id}`);
  }

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title={gateway.name}
        subtitle={`Session ${sessionKey} · ${gateway.url}`}
        action={
          <div className="flex items-center gap-2 self-center">
            <Badge tone={gateway.status === "online" ? "low" : "high"}>{gateway.status.replace("_", " ")}</Badge>
            <form action={recheck}>
              <button className="text-xs text-jericho-muted hover:text-jericho-text" type="submit">
                re-check
              </button>
            </form>
          </div>
        }
      />

      {gateway.status === "pairing_pending" && (
        <Panel className="mb-4 border-jericho-warn/40 bg-jericho-warn/10">
          <p className="text-sm">
            Waiting for approval on the device — run <code>openclaw devices approve</code> on {gateway.name}, then re-check.
          </p>
        </Panel>
      )}

      {cache.agents.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {cache.agents.map((a) => {
            const isCurrent = gatewaySessionKey(gateway, a.id) === sessionKey;
            return (
              <Link
                key={a.id}
                href={`/agents/${gateway.id}?agent=${encodeURIComponent(a.id)}`}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  isCurrent
                    ? "border-jericho-accent text-jericho-text"
                    : "border-jericho-border text-jericho-muted hover:text-jericho-text"
                }`}
              >
                {a.emoji ? `${a.emoji} ` : ""}
                {a.name ?? a.id}
              </Link>
            );
          })}
        </div>
      )}

      <Panel className="mb-4">
        {messages.length === 0 ? (
          <p className="text-sm text-jericho-muted text-center py-8">
            No messages yet — say hello, or hand the agent a task.
          </p>
        ) : (
          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </div>
        )}
      </Panel>

      <form action={send} className="flex gap-2">
        <input type="hidden" name="agentId" value={agent ?? ""} />
        <textarea
          name="text"
          rows={2}
          required
          placeholder={active ? "Agent is replying…" : "Message the agent — ask a question or assign work"}
          className="flex-1 rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
        />
        <button
          className="self-end rounded-lg bg-jericho-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          type="submit"
          disabled={active}
        >
          Send
        </button>
      </form>

      {messages.length > 0 && (
        <form action={clear} className="mt-3">
          <input type="hidden" name="sessionKey" value={sessionKey} />
          <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
            Clear this transcript (device history is unaffected)
          </button>
        </form>
      )}
    </>
  );
}

function MessageBubble({ m }: { m: AgentChatMessageRow }) {
  const isUser = m.role === "user";
  const working = m.status === "pending" || m.status === "streaming";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
          isUser ? "bg-jericho-accent/15 text-jericho-text" : "border border-jericho-border bg-jericho-bg"
        }`}
      >
        {m.content || (working ? <span className="text-jericho-muted animate-pulse">thinking…</span> : null)}
        {m.status === "streaming" && m.content && <span className="text-jericho-muted animate-pulse"> ▍</span>}
        {m.status === "error" && (
          <div className="text-xs text-jericho-bad mt-1">{m.error ?? "The agent reported an error."}</div>
        )}
        <div className="text-[10px] text-jericho-muted mt-1">{new Date(m.createdAt).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
