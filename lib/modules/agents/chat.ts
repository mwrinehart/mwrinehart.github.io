// Chat transcripts + turn execution against gateway agents.
//
// A turn is two rows: the user message (final immediately) and an assistant
// placeholder that advances pending → streaming → final|error as gateway chat
// events arrive. Pages kick off executeChatTurn() with next/server's after() so
// the form action returns instantly and the UI polls the transcript.

import { randomUUID } from "crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { agentChatMessages, agentGateways, type AgentChatMessageRow } from "./schema";
import { gatewayConnectionOpts, gatewaySessionKey, getGateway } from "./gateways";
import { GatewayError, runChatTurn, withGateway } from "./client";

// Agents do real work (shell commands, browsing, coding) — give them minutes,
// not seconds, before the dashboard gives up on a reply.
const CHAT_TIMEOUT_MS = 5 * 60_000;
// An assistant row stuck in pending/streaming longer than this is abandoned
// (server restart mid-run) and no longer blocks new sends.
const STALE_RUN_MS = 10 * 60_000;
const DELTA_FLUSH_MS = 750;

export function listMessages(orgId: string, gatewayId: string, sessionKey: string) {
  return db
    .select()
    .from(agentChatMessages)
    .where(
      and(
        eq(agentChatMessages.orgId, orgId),
        eq(agentChatMessages.gatewayId, gatewayId),
        eq(agentChatMessages.sessionKey, sessionKey),
      ),
    )
    .orderBy(asc(agentChatMessages.createdAt));
}

export function isRunActive(m: AgentChatMessageRow): boolean {
  return (
    m.role === "assistant" &&
    (m.status === "pending" || m.status === "streaming") &&
    Date.now() - m.updatedAt < STALE_RUN_MS
  );
}

export interface StartedTurn {
  assistantMessageId: string;
  gatewayId: string;
  sessionKey: string;
}

// Insert the user + placeholder rows for one turn. The caller schedules
// executeChatTurn(started) afterwards (via next/server after()).
export async function startChatTurn(
  orgId: string,
  gatewayId: string,
  input: { text: string; agentId?: string | null; broadcastId?: string | null },
): Promise<StartedTurn> {
  const gateway = await getGateway(orgId, gatewayId);
  if (!gateway) throw new Error("Gateway not found.");
  const sessionKey = gatewaySessionKey(gateway, input.agentId);

  const existing = await listMessages(orgId, gatewayId, sessionKey);
  if (existing.some(isRunActive)) {
    throw new Error("The agent is still replying in this session — wait for it to finish.");
  }

  const now = Date.now();
  const assistantMessageId = randomUUID();
  await db.insert(agentChatMessages).values([
    {
      id: randomUUID(),
      orgId,
      gatewayId,
      sessionKey,
      role: "user",
      content: input.text,
      status: "final",
      broadcastId: input.broadcastId ?? null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: assistantMessageId,
      orgId,
      gatewayId,
      sessionKey,
      role: "assistant",
      content: "",
      status: "pending",
      broadcastId: input.broadcastId ?? null,
      createdAt: now + 1,
      updatedAt: now + 1,
    },
  ]);
  return { assistantMessageId, gatewayId, sessionKey };
}

async function updateAssistant(
  orgId: string,
  id: string,
  patch: Partial<{ content: string; status: string; error: string | null }>,
): Promise<void> {
  await db
    .update(agentChatMessages)
    .set({ ...patch, updatedAt: Date.now() })
    .where(and(eq(agentChatMessages.orgId, orgId), eq(agentChatMessages.id, id)));
}

// The long-running half of a turn: connect, chat.send, stream deltas into the
// assistant row, settle it as final|error. Never throws (errors land on the row
// and, for connect failures, on the gateway's status snapshot).
export async function executeChatTurn(orgId: string, turn: StartedTurn, text: string): Promise<void> {
  const gateway = await getGateway(orgId, turn.gatewayId);
  if (!gateway) return;

  let lastFlush = 0;
  let flushing: Promise<void> = Promise.resolve();

  try {
    const opts = await gatewayConnectionOpts(orgId, gateway);
    const result = await withGateway(opts, (conn) =>
      runChatTurn(conn, {
        sessionKey: turn.sessionKey,
        message: text,
        timeoutMs: CHAT_TIMEOUT_MS,
        onDelta: (accumulated) => {
          const now = Date.now();
          if (now - lastFlush < DELTA_FLUSH_MS) return;
          lastFlush = now;
          // Serialize flushes so out-of-order UPDATEs can't regress content.
          flushing = flushing
            .then(() => updateAssistant(orgId, turn.assistantMessageId, { content: accumulated, status: "streaming" }))
            .catch(() => {});
        },
      }),
    );
    // Let in-flight delta flushes land before the terminal write so a stale
    // "streaming" UPDATE can't overwrite the final row.
    await flushing;
    await updateAssistant(orgId, turn.assistantMessageId, {
      content: result.text,
      status: result.status,
      error: result.error ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await flushing;
    await updateAssistant(orgId, turn.assistantMessageId, { status: "error", error: message });
    if (err instanceof GatewayError) {
      // Reflect connect-level failures (pairing, bad token, offline) on the
      // fleet page without waiting for the next manual probe.
      await db
        .update(agentGateways)
        .set({ status: err.status, statusDetail: message, updatedAt: Date.now() })
        .where(and(eq(agentGateways.orgId, orgId), eq(agentGateways.id, turn.gatewayId)));
    }
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

// One composer submission fanned out to several devices. Returns the turns to
// schedule; gateways that fail to start (e.g. a run already active) get an
// error row so the batch view stays complete.
export async function startBroadcast(
  orgId: string,
  gatewayIds: string[],
  text: string,
): Promise<{ broadcastId: string; turns: StartedTurn[] }> {
  const broadcastId = randomUUID();
  const turns: StartedTurn[] = [];
  for (const gatewayId of gatewayIds) {
    try {
      turns.push(await startChatTurn(orgId, gatewayId, { text, broadcastId }));
    } catch (err) {
      const now = Date.now();
      await db.insert(agentChatMessages).values({
        id: randomUUID(),
        orgId,
        gatewayId,
        sessionKey: "broadcast",
        role: "assistant",
        content: "",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        broadcastId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return { broadcastId, turns };
}

export interface BroadcastView {
  broadcastId: string;
  prompt: string;
  sentAt: number;
  replies: AgentChatMessageRow[];
}

// Most-recent broadcasts with their per-gateway replies, newest first.
export async function listBroadcasts(orgId: string, limit = 5): Promise<BroadcastView[]> {
  const rows = await db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.orgId, orgId))
    .orderBy(desc(agentChatMessages.createdAt))
    .limit(400);
  const withBroadcast = rows.filter((r) => r.broadcastId);
  const order: string[] = [];
  const byId = new Map<string, AgentChatMessageRow[]>();
  for (const row of withBroadcast) {
    const bid = row.broadcastId as string;
    if (!byId.has(bid)) {
      if (order.length >= limit) continue;
      order.push(bid);
      byId.set(bid, []);
    }
    byId.get(bid)?.push(row);
  }
  return order.map((bid) => {
    const msgs = byId.get(bid) ?? [];
    const prompt = msgs.find((m) => m.role === "user");
    return {
      broadcastId: bid,
      prompt: prompt?.content ?? "",
      sentAt: prompt?.createdAt ?? msgs[msgs.length - 1]?.createdAt ?? 0,
      replies: msgs.filter((m) => m.role === "assistant").sort((a, b) => a.createdAt - b.createdAt),
    };
  });
}

// Whether any assistant row in the given set is still working — drives the
// UI's auto-refresh polling.
export function anyActive(messages: AgentChatMessageRow[]): boolean {
  return messages.some(isRunActive);
}

export async function clearSession(orgId: string, gatewayId: string, sessionKey: string): Promise<void> {
  await db
    .delete(agentChatMessages)
    .where(
      and(
        eq(agentChatMessages.orgId, orgId),
        eq(agentChatMessages.gatewayId, gatewayId),
        eq(agentChatMessages.sessionKey, sessionKey),
      ),
    );
}
