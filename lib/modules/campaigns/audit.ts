// Append-only, actor-aware audit log for the Campaigns module. Every state change
// routes through logAudit so the trail is continuous and tamper-evident (rows are
// only ever inserted, never updated or deleted).

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { campaignAudit } from "./schema";

export async function logAudit(
  orgId: string,
  campaignId: string | null,
  actorUserId: string,
  action: string,
  detail?: string,
): Promise<void> {
  await db.insert(campaignAudit).values({
    id: randomUUID(),
    orgId,
    campaignId,
    actorUserId,
    action,
    detail: detail ?? null,
    createdAt: Date.now(),
  });
}

export function listAudit(orgId: string, limit = 100) {
  return db
    .select()
    .from(campaignAudit)
    .where(eq(campaignAudit.orgId, orgId))
    .orderBy(desc(campaignAudit.createdAt))
    .limit(limit);
}

export function listCampaignAudit(orgId: string, campaignId: string, limit = 25) {
  return db
    .select()
    .from(campaignAudit)
    .where(and(eq(campaignAudit.orgId, orgId), eq(campaignAudit.campaignId, campaignId)))
    .orderBy(desc(campaignAudit.createdAt))
    .limit(limit);
}
