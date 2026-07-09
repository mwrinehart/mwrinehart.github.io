// ─── Agents module (OpenClaw fleet) — gateway protocol helpers ────────────────
//
// Pure functions and types for the OpenClaw Gateway WebSocket protocol (v4).
// No db/network imports so everything here is unit-testable. The wire contract
// is mirrored from openclaw's packages/gateway-protocol and
// packages/gateway-client/src/device-auth.ts:
//
//   frame:    {type:"req"|"res"|"event", ...}
//   connect:  first client frame must be a `connect` req answering the
//             `connect.challenge` event's nonce with an Ed25519 device signature
//   payload:  "v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily"

export const PROTOCOL_VERSION = 4;

export const OPERATOR_READ_SCOPE = "operator.read";
export const OPERATOR_WRITE_SCOPE = "operator.write";

// ─── Frames ───────────────────────────────────────────────────────────────────

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
}

export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

export type GatewayFrame = ResponseFrame | EventFrame;

// Parse one WS text frame. Returns null for anything that isn't a well-formed
// res/event object — the stream also carries ticks and frames we don't model.
export function parseFrame(raw: unknown): GatewayFrame | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "res" && typeof obj.id === "string" && typeof obj.ok === "boolean") {
    return obj as unknown as ResponseFrame;
  }
  if (obj.type === "event" && typeof obj.event === "string") {
    return obj as unknown as EventFrame;
  }
  return null;
}

// ─── Device-auth signature payload ────────────────────────────────────────────

// The gateway compares signatures byte-for-byte; optional metadata is
// lowercased before joining exactly like openclaw's client does.
export function normalizeDeviceMetadataForAuth(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

export interface DeviceAuthPayloadParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}

export function buildDeviceAuthPayloadV3(params: DeviceAuthPayloadParams): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily),
  ].join("|");
}

// ─── Connect error / probe classification ─────────────────────────────────────

export type GatewayStatus =
  | "online"
  | "pairing_pending"
  | "unauthorized"
  | "unreachable"
  | "unknown";

// Classify a failed connect so the UI can say "approve this device on the
// gateway" instead of a generic error. Matches openclaw's probe heuristics
// (PAIRING_REQUIRED detail code / "pairing required" close reason).
export function classifyConnectFailure(message: string): GatewayStatus {
  const m = message.toLowerCase();
  if (m.includes("pairing")) return "pairing_pending";
  if (
    m.includes("unauthorized") ||
    m.includes("auth") ||
    m.includes("token") ||
    m.includes("forbidden")
  ) {
    return "unauthorized";
  }
  return "unreachable";
}

// ─── Session keys ─────────────────────────────────────────────────────────────

// agents.list returns { defaultId, mainKey, agents } where mainKey is the full
// session key of the default agent's main session (e.g. "agent:main:main").
export function defaultSessionKey(agentId: string, defaultId?: string, mainKey?: string): string {
  if (defaultId && mainKey && agentId === defaultId && mainKey.includes(":")) return mainKey;
  return `agent:${agentId}:main`;
}

// ─── Chat events ──────────────────────────────────────────────────────────────

export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  deltaText?: string;
  replace?: boolean;
  message?: unknown;
  errorMessage?: string;
}

export function parseChatEventPayload(payload: unknown): ChatEventPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.runId !== "string" || typeof p.sessionKey !== "string") return null;
  if (p.state !== "delta" && p.state !== "final" && p.state !== "aborted" && p.state !== "error") {
    return null;
  }
  return {
    runId: p.runId,
    sessionKey: p.sessionKey,
    state: p.state,
    deltaText: typeof p.deltaText === "string" ? p.deltaText : undefined,
    replace: p.replace === true,
    message: p.message,
    errorMessage: typeof p.errorMessage === "string" ? p.errorMessage : undefined,
  };
}

// Chat `message` payloads carry model-shaped content (string or an array of
// {type:"text",text} parts). Pull out the readable text, best-effort.
export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.content === "string") return m.content;
  if (typeof m.text === "string") return m.text;
  if (Array.isArray(m.content)) {
    return m.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const p = part as Record<string, unknown>;
        return typeof p.text === "string" ? p.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
