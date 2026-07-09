// Gateway registry + live probing. A "gateway" is one OpenClaw install on one of
// the org's devices. Tokens live in the org's encrypted secret blob (platform
// spine), keyed per gateway; rows carry only metadata plus the last probe
// snapshot so lists render instantly.

import { randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { clearOrgSecrets, getOrgSecret, setOrgSecrets } from "@/lib/platform/secrets";
import { agentGateways, type AgentGatewayRow } from "./schema";
import { getOrCreateDeviceIdentity } from "./identity";
import { GatewayError, normalizeGatewayUrl, withGateway } from "./client";
import { defaultSessionKey, type GatewayStatus } from "./protocol";

const tokenSecretKey = (gatewayId: string) => `openclaw.gateway.${gatewayId}.token`;

export interface AgentSummary {
  id: string;
  name?: string;
  emoji?: string;
  model?: string;
}

export interface AgentsCache {
  defaultId?: string;
  mainKey?: string;
  agents: AgentSummary[];
}

export function parseAgentsCache(json: string | null): AgentsCache {
  if (!json) return { agents: [] };
  try {
    const parsed = JSON.parse(json) as AgentsCache;
    return { ...parsed, agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch {
    return { agents: [] };
  }
}

export function listGateways(orgId: string) {
  return db.select().from(agentGateways).where(eq(agentGateways.orgId, orgId)).orderBy(asc(agentGateways.createdAt));
}

export async function getGateway(orgId: string, id: string): Promise<AgentGatewayRow | null> {
  const rows = await db
    .select()
    .from(agentGateways)
    .where(and(eq(agentGateways.orgId, orgId), eq(agentGateways.id, id)));
  return rows[0] ?? null;
}

// Cheap counts for the cross-module dashboard.
export async function agentsOverview(orgId: string): Promise<{ devices: number; online: number }> {
  const [tot] = await db
    .select({ n: sql<number>`count(*)` })
    .from(agentGateways)
    .where(eq(agentGateways.orgId, orgId));
  const [on] = await db
    .select({ n: sql<number>`count(*)` })
    .from(agentGateways)
    .where(and(eq(agentGateways.orgId, orgId), eq(agentGateways.status, "online")));
  return { devices: Number(tot?.n ?? 0), online: Number(on?.n ?? 0) };
}

export async function addGateway(
  orgId: string,
  input: { name: string; url: string; token: string },
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.insert(agentGateways).values({
    id,
    orgId,
    name: input.name.trim() || "Unnamed device",
    url: normalizeGatewayUrl(input.url),
    status: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  if (input.token.trim()) {
    await setOrgSecrets(orgId, { [tokenSecretKey(id)]: input.token.trim() });
  }
  return id;
}

export async function removeGateway(orgId: string, id: string): Promise<void> {
  await db.delete(agentGateways).where(and(eq(agentGateways.orgId, orgId), eq(agentGateways.id, id)));
  await clearOrgSecrets(orgId, [tokenSecretKey(id)]);
}

export async function updateGatewayToken(orgId: string, id: string, token: string): Promise<void> {
  const gw = await getGateway(orgId, id);
  if (!gw) throw new Error("Gateway not found.");
  await setOrgSecrets(orgId, { [tokenSecretKey(id)]: token.trim() });
}

// Resolve everything needed to open a connection to one gateway.
export async function gatewayConnectionOpts(orgId: string, gateway: AgentGatewayRow) {
  const [identity, token] = await Promise.all([
    getOrCreateDeviceIdentity(orgId),
    getOrgSecret(orgId, tokenSecretKey(gateway.id)),
  ]);
  return { url: gateway.url, token: token ?? "", identity };
}

// Connect, refresh the agents.list cache, and persist the status snapshot.
// Never throws — the resulting status/detail is the UI's error surface.
export async function probeGateway(orgId: string, id: string): Promise<AgentGatewayRow | null> {
  const gateway = await getGateway(orgId, id);
  if (!gateway) return null;

  let status: GatewayStatus = "online";
  let statusDetail: string | null = null;
  let agentsJson: string | null = gateway.agentsJson;

  try {
    const opts = await gatewayConnectionOpts(orgId, gateway);
    const result = (await withGateway(opts, (conn) => conn.request("agents.list", {}))) as {
      defaultId?: string;
      mainKey?: string;
      agents?: Array<{ id: string; name?: string; identity?: { emoji?: string; name?: string }; model?: { primary?: string } }>;
    };
    const cache: AgentsCache = {
      defaultId: result?.defaultId,
      mainKey: result?.mainKey,
      agents: (result?.agents ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? a.identity?.name,
        emoji: a.identity?.emoji,
        model: a.model?.primary,
      })),
    };
    agentsJson = JSON.stringify(cache);
  } catch (err) {
    status = err instanceof GatewayError ? err.status : "unreachable";
    statusDetail = err instanceof Error ? err.message : String(err);
  }

  await db
    .update(agentGateways)
    .set({ status, statusDetail, agentsJson, lastProbeAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(agentGateways.orgId, orgId), eq(agentGateways.id, id)));
  return getGateway(orgId, id);
}

export async function probeAllGateways(orgId: string): Promise<void> {
  const gateways = await listGateways(orgId);
  await Promise.all(gateways.map((g) => probeGateway(orgId, g.id)));
}

// The session the dashboard talks to on a gateway: the default agent's main
// session unless the caller picked a specific agent.
export function gatewaySessionKey(gateway: AgentGatewayRow, agentId?: string | null): string {
  const cache = parseAgentsCache(gateway.agentsJson);
  const target = agentId?.trim() || cache.defaultId || "main";
  return defaultSessionKey(target, cache.defaultId, cache.mainKey);
}
