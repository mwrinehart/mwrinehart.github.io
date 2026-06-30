// Campaign lifecycle + mission control (rebuilt from Mirage). Status transitions
// run through a policy gate (a campaign can't go active without an approved
// launch approval), autonomy mode is tracked, and an objective can be expanded
// into a blueprint by the shared Anthropic client. Every mutation is audited.

import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complete, orgAnthropicKey } from "@/lib/platform/ai";
import { campaignApprovals, campaigns } from "./schema";
import { logAudit } from "./audit";

export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type AutonomyMode = "manual" | "review" | "auto";

export function listCampaigns(orgId: string) {
  return db.select().from(campaigns).where(eq(campaigns.orgId, orgId)).orderBy(desc(campaigns.updatedAt));
}

// Cheap counts for the cross-module dashboard.
export async function campaignsOverview(orgId: string): Promise<{ total: number; active: number }> {
  const [tot] = await db.select({ n: sql<number>`count(*)` }).from(campaigns).where(eq(campaigns.orgId, orgId));
  const [act] = await db
    .select({ n: sql<number>`count(*)` })
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), eq(campaigns.status, "active")));
  return { total: Number(tot?.n ?? 0), active: Number(act?.n ?? 0) };
}

export async function getCampaign(orgId: string, id: string) {
  const rows = await db.select().from(campaigns).where(and(eq(campaigns.orgId, orgId), eq(campaigns.id, id)));
  return rows[0] ?? null;
}

export async function createCampaign(orgId: string, userId: string, input: { name: string; objective?: string }): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.insert(campaigns).values({
    id,
    orgId,
    name: input.name.trim(),
    objective: input.objective ?? null,
    status: "draft",
    autonomyMode: "manual",
    riskScore: 0,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
  await logAudit(orgId, id, userId, "campaign.created", input.name.trim());
  return id;
}

// Policy gate: activating a campaign requires an approved launch approval.
// Allowed status transitions — completed is terminal; no jumps to arbitrary states.
const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active"],
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: [],
};

export async function setStatus(orgId: string, userId: string, id: string, status: CampaignStatus): Promise<void> {
  // Validate the requested status and the transition (the status arrives from a
  // client form, so don't trust the `as CampaignStatus` cast).
  if (!(status in STATUS_TRANSITIONS)) throw new Error(`Invalid status: ${status}`);
  const current = await getCampaign(orgId, id);
  if (!current) throw new Error("Campaign not found");
  if (current.status === status) return; // no-op
  if (!STATUS_TRANSITIONS[current.status as CampaignStatus]?.includes(status)) {
    throw new Error(`Illegal transition: ${current.status} → ${status}`);
  }
  if (status === "active") {
    const approved = await db
      .select({ id: campaignApprovals.id })
      .from(campaignApprovals)
      .where(
        and(
          eq(campaignApprovals.orgId, orgId),
          eq(campaignApprovals.campaignId, id),
          eq(campaignApprovals.type, "launch"),
          eq(campaignApprovals.status, "approved"),
        ),
      );
    if (approved.length === 0) {
      throw new Error("Launch gate: an approved launch approval is required before activating.");
    }
  }
  await db.update(campaigns).set({ status, updatedAt: Date.now() }).where(and(eq(campaigns.orgId, orgId), eq(campaigns.id, id)));
  await logAudit(orgId, id, userId, `campaign.status.${status}`);
}

export async function setAutonomyMode(orgId: string, userId: string, id: string, mode: AutonomyMode): Promise<void> {
  await db.update(campaigns).set({ autonomyMode: mode, updatedAt: Date.now() }).where(and(eq(campaigns.orgId, orgId), eq(campaigns.id, id)));
  await logAudit(orgId, id, userId, `campaign.autonomy.${mode}`);
}

export const aiKeyFor = orgAnthropicKey;

export async function generateBlueprint(orgId: string, userId: string, id: string): Promise<void> {
  const campaign = await getCampaign(orgId, id);
  if (!campaign) throw new Error("Campaign not found");
  const apiKey = await aiKeyFor(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  const blueprint = await complete(
    [{ role: "user", content: `Objective:\n${campaign.objective || campaign.name}` }],
    {
      system:
        "You are a security-awareness campaign planner. Produce a concise campaign blueprint as markdown with these sections: Phases, Target personas, Message themes, Guardrails, Success metrics. Keep it practical and within ethical/authorized simulation bounds.",
      maxTokens: 900,
      apiKey,
    },
  );

  await db.update(campaigns).set({ blueprint, updatedAt: Date.now() }).where(and(eq(campaigns.orgId, orgId), eq(campaigns.id, id)));
  await logAudit(orgId, id, userId, "campaign.blueprint.generated");
}
