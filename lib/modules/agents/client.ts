// ─── Agents module — OpenClaw gateway WebSocket client ────────────────────────
//
// Thin client over Node 22's built-in WebSocket. One connection per operation:
// open → connect handshake (challenge nonce + Ed25519 device signature + shared
// token) → issue requests / stream chat events → close. No connection pooling;
// gateways are on the user's own devices and handshakes are cheap.
//
// Remote (non-loopback) devices are never silently paired: the first connect
// from a fresh identity is refused with "pairing required" until the owner
// approves the device on the gateway (`openclaw devices approve` / Control UI).
// classifyConnectFailure() turns that refusal into a "pairing_pending" status
// the UI can explain.

import { randomUUID } from "crypto";
import {
  buildDeviceAuthPayloadV3,
  classifyConnectFailure,
  extractMessageText,
  OPERATOR_READ_SCOPE,
  OPERATOR_WRITE_SCOPE,
  parseChatEventPayload,
  parseFrame,
  PROTOCOL_VERSION,
  type EventFrame,
  type GatewayStatus,
  type ResponseFrame,
} from "./protocol";
import { signDevicePayload, type OrgDeviceIdentity } from "./identity";

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;

export class GatewayError extends Error {
  status: GatewayStatus;
  constructor(message: string, status?: GatewayStatus) {
    super(message);
    this.name = "GatewayError";
    this.status = status ?? classifyConnectFailure(message);
  }
}

// Accept "host:port", "http(s)://…" and "ws(s)://…" and normalize to ws(s)://.
export function normalizeGatewayUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https/i, "wss");
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, "ws");
  return `ws://${trimmed}`;
}

export interface GatewayConnection {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  onEvent(handler: (frame: EventFrame) => void): void;
  close(): void;
}

interface Pending {
  resolve(payload: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export async function connectGateway(opts: {
  url: string;
  token: string;
  identity: OrgDeviceIdentity;
  instanceLabel?: string;
}): Promise<GatewayConnection> {
  const url = normalizeGatewayUrl(opts.url);
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    throw new GatewayError(`Invalid gateway URL: ${String(err)}`, "unreachable");
  }

  const pending = new Map<string, Pending>();
  const eventHandlers: Array<(frame: EventFrame) => void> = [];
  let closed = false;

  const failAll = (err: Error) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };

  ws.addEventListener("message", (ev: MessageEvent) => {
    const frame = parseFrame(typeof ev.data === "string" ? ev.data : null);
    if (!frame) return;
    if (frame.type === "res") {
      const p = pending.get(frame.id);
      if (!p) return;
      pending.delete(frame.id);
      clearTimeout(p.timer);
      if (frame.ok) p.resolve(frame.payload);
      else p.reject(new GatewayError(frame.error?.message || "gateway request failed"));
      return;
    }
    for (const handler of eventHandlers) handler(frame);
  });
  ws.addEventListener("close", (ev: CloseEvent) => {
    closed = true;
    failAll(new GatewayError(ev.reason ? `connection closed: ${ev.reason}` : "connection closed"));
  });
  ws.addEventListener("error", () => {
    closed = true;
    failAll(new GatewayError(`could not reach gateway at ${url}`, "unreachable"));
  });

  const conn: GatewayConnection = {
    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
      if (closed) return Promise.reject(new GatewayError("connection closed"));
      const id = randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new GatewayError(`gateway request timed out: ${method}`, "unreachable"));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ type: "req", id, method, params }));
      });
    },
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };

  // 1. Wait for socket open + the gateway's connect.challenge nonce.
  const nonce = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.close();
      reject(new GatewayError(`timed out waiting for gateway handshake at ${url}`, "unreachable"));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener("close", (ev: CloseEvent) => {
      clearTimeout(timer);
      reject(new GatewayError(ev.reason ? `gateway refused connection: ${ev.reason}` : `gateway closed the connection during handshake`));
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new GatewayError(`could not reach gateway at ${url}`, "unreachable"));
    });
    conn.onEvent((frame) => {
      if (frame.event !== "connect.challenge") return;
      const n = (frame.payload as { nonce?: unknown } | undefined)?.nonce;
      if (typeof n === "string" && n.trim()) {
        clearTimeout(timer);
        resolve(n.trim());
      }
    });
  });

  // 2. Sign the challenge and send the connect request.
  const scopes = [OPERATOR_READ_SCOPE, OPERATOR_WRITE_SCOPE];
  const client = {
    id: "cli",
    displayName: opts.instanceLabel ?? "Jericho Agents dashboard",
    version: "1.0.0",
    platform: "linux",
    mode: "cli",
    instanceId: opts.identity.deviceId.slice(0, 16),
  };
  const signedAtMs = Date.now();
  const signature = signDevicePayload(
    opts.identity.privateKeyPem,
    buildDeviceAuthPayloadV3({
      deviceId: opts.identity.deviceId,
      clientId: client.id,
      clientMode: client.mode,
      role: "operator",
      scopes,
      signedAtMs,
      token: opts.token || null,
      nonce,
      platform: client.platform,
    }),
  );

  try {
    await conn.request("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client,
      role: "operator",
      scopes,
      auth: opts.token ? { token: opts.token } : undefined,
      device: {
        id: opts.identity.deviceId,
        publicKey: opts.identity.publicKeyRawB64u,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    });
  } catch (err) {
    conn.close();
    throw err instanceof GatewayError ? err : new GatewayError(String(err));
  }

  return conn;
}

export async function withGateway<T>(
  opts: { url: string; token: string; identity: OrgDeviceIdentity; instanceLabel?: string },
  fn: (conn: GatewayConnection) => Promise<T>,
): Promise<T> {
  const conn = await connectGateway(opts);
  try {
    return await fn(conn);
  } finally {
    conn.close();
  }
}

// ─── Chat turn ────────────────────────────────────────────────────────────────

export interface ChatTurnResult {
  text: string;
  status: "final" | "error";
  error?: string;
}

// Send one message into a session and stream the reply until a terminal chat
// event. onDelta receives the accumulated text so the caller can persist
// progress for the UI to poll.
export async function runChatTurn(
  conn: GatewayConnection,
  opts: {
    sessionKey: string;
    message: string;
    timeoutMs: number;
    onDelta?: (text: string) => void;
  },
): Promise<ChatTurnResult> {
  return new Promise<ChatTurnResult>((resolve) => {
    let accumulated = "";
    let runId: string | null = null;
    let done = false;

    const finish = (result: ChatTurnResult) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      resolve(result);
    };

    const deadline = setTimeout(() => {
      finish({
        text: accumulated,
        status: "error",
        error: `No reply within ${Math.round(opts.timeoutMs / 1000)}s. The agent may still be working — check the session on the device.`,
      });
    }, opts.timeoutMs);

    conn.onEvent((frame) => {
      if (frame.event !== "chat") return;
      const evt = parseChatEventPayload(frame.payload);
      if (!evt || evt.sessionKey !== opts.sessionKey) return;
      // The ack's runId (when present) scopes us to our own run; without it,
      // fall back to adopting the first run seen on this session.
      if (runId && evt.runId !== runId) return;
      if (!runId) runId = evt.runId;

      if (evt.state === "delta") {
        if (evt.replace) accumulated = evt.deltaText ?? "";
        else accumulated += evt.deltaText ?? "";
        opts.onDelta?.(accumulated);
        return;
      }
      if (evt.state === "final") {
        const finalText = extractMessageText(evt.message) || accumulated;
        finish({ text: finalText, status: "final" });
        return;
      }
      finish({
        text: accumulated,
        status: "error",
        error: evt.errorMessage || (evt.state === "aborted" ? "Run was aborted on the gateway." : "The agent reported an error."),
      });
    });

    conn
      .request(
        "chat.send",
        {
          sessionKey: opts.sessionKey,
          message: opts.message,
          deliver: false,
          idempotencyKey: randomUUID(),
        },
        30_000,
      )
      .then((ack) => {
        const ackRunId = (ack as { runId?: unknown } | undefined)?.runId;
        if (typeof ackRunId === "string" && ackRunId) runId = ackRunId;
      })
      .catch((err: Error) => {
        finish({ text: accumulated, status: "error", error: err.message });
      });
  });
}
