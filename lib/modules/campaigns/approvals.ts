// Campaign approval workflow (rebuilt from Mirage's expansion-approval + launch
// sign-off). Members request approvals (launch / expansion / content); admins
// decide. Requests notify the org's default channel best-effort, and every
// request/decision is audited. Role enforcement happens in the page via
// requireTenant("admin") for decisions.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { notify } from "@/lib/platform/notify";
import { campaignApprovals, campaigns } from "./schema";
import { logAudit } from "./audit";

// Content sign-off happens on the content job itself (decideJob), so the approval
// workflow covers launch + scope expansion only — no decorative, unlinked
// "content" approval rows.
export type ApprovalType = "launch" | "expansion";
export type Decision = "approved" | "rejected";

export function listPendingApprovals(orgId: string) {
  return db
    .select()
    .from(campaignApprovals)
    .where(and(eq(campaignApprovals.orgId, orgId), eq(campaignApprovals.status, "pending")))
    .orderBy(desc(campaignApprovals.createdAt));
}

export function listApprovalsForCampaign(orgId: string, campaignId: string) {
  return db
    .select()
    .from(campaignApprovals)
    .where(and(eq(campaignApprovals.orgId, orgId), eq(campaignApprovals.campaignId, campaignId)))
    .orderBy(desc(campaignApprovals.createdAt));
}

export async function requestApproval(
  orgId: string,
  userId: string,
  campaignId: string,
  input: { type: ApprovalType; title: string; detail?: string; riskScore?: number },
): Promise<void> {
  await db.insert(campaignApprovals).values({
    id: randomUUID(),
    orgId,
    campaignId,
    type: input.type,
    title: input.title.trim(),
    detail: input.detail ?? null,
    riskScore: Math.max(0, Math.min(100, input.riskScore ?? 0)),
    status: "pending",
    requestedByUserId: userId,
    createdAt: Date.now(),
  });
  await logAudit(orgId, campaignId, userId, `approval.requested.${input.type}`, input.title.trim());
  // Best-effort heads-up to the org's default channel (skipped if none configured).
  await notify({
    orgId,
    channel: "slack",
    subject: `Approval requested: ${input.type}`,
    body: `${input.title}${input.detail ? `\n${input.detail}` : ""}`,
    module: "campaigns",
  });
}

export async function decideApproval(
  orgId: string,
  userId: string,
  approvalId: string,
  decision: Decision,
  note?: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(campaignApprovals)
    .where(and(eq(campaignApprovals.orgId, orgId), eq(campaignApprovals.id, approvalId)));
  const approval = rows[0];
  if (!approval) return;
  // Atomic guard: only a still-pending approval transitions, so concurrent
  // decisions can't double-decide / double-audit or clobber each other.
  const updated = await db
    .update(campaignApprovals)
    .set({ status: decision, decidedByUserId: userId, decisionNote: note ?? null, decidedAt: Date.now() })
    .where(and(eq(campaignApprovals.orgId, orgId), eq(campaignApprovals.id, approvalId), eq(campaignApprovals.status, "pending")))
    .returning({ id: campaignApprovals.id });
  if (!updated.length) return;
  await logAudit(orgId, approval.campaignId, userId, `approval.${decision}.${approval.type}`, approval.title);
}

// Convenience for the campaign detail page: pending count + whether a launch is approved.
export async function campaignGateStatus(orgId: string, campaignId: string): Promise<{ launchApproved: boolean; pending: number }> {
  const rows = await listApprovalsForCampaign(orgId, campaignId);
  return {
    launchApproved: rows.some((a) => a.type === "launch" && a.status === "approved"),
    pending: rows.filter((a) => a.status === "pending").length,
  };
}

// Re-exported so the page can show the campaign name alongside an approval.
export async function campaignName(orgId: string, campaignId: string): Promise<string> {
  const rows = await db.select({ name: campaigns.name }).from(campaigns).where(and(eq(campaigns.orgId, orgId), eq(campaigns.id, campaignId)));
  return rows[0]?.name ?? "(unknown)";
}
