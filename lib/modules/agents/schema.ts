// ─── Agents module (OpenClaw fleet) — data model ──────────────────────────────
//
// A gateway row is one OpenClaw install on one device (laptop, home server, …).
// The auth token lives in the org's encrypted secret blob (keyed by gateway id),
// NOT in these tables — the row only carries connection metadata plus a cached
// probe snapshot so the fleet page renders without touching the network.
//
// Chat transcripts are stored per (gateway, sessionKey). The platform is the
// source of truth for what was said *through this dashboard*; the device's own
// session history stays on the device.

import { bigint, pgTable, text } from "drizzle-orm/pg-core";

export const agentGateways = pgTable("agent_gateways", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(), // device label, e.g. "MacBook Pro" / "Home server"
  url: text("url").notNull(), // ws(s)://host:port
  // online | pairing_pending | unauthorized | unreachable | unknown
  status: text("status").notNull().default("unknown"),
  statusDetail: text("status_detail"),
  // Cached agents.list result (JSON: { defaultId, mainKey, agents: [...] }).
  agentsJson: text("agents_json"),
  lastProbeAt: bigint("last_probe_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const agentChatMessages = pgTable("agent_chat_messages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  gatewayId: text("gateway_id").notNull(),
  sessionKey: text("session_key").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull().default(""),
  // user rows are always 'final'; assistant rows go pending → streaming → final|error
  status: text("status").notNull().default("final"),
  error: text("error"),
  // Groups the responses of one broadcast composer submission across gateways.
  broadcastId: text("broadcast_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type AgentGatewayRow = typeof agentGateways.$inferSelect;
export type AgentChatMessageRow = typeof agentChatMessages.$inferSelect;
