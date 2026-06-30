// Content jobs — the unit of work a campaign produces, gated by autonomy mode.
//
// Flow: create a brief → AI-draft the content → submit. Submission runs through
// evaluateGate, which resolves the Mirage "go / review / blocked" decision from
// the campaign's status, autonomy mode, and the job's risk:
//   - campaign not active        → blocked
//   - autonomy "auto"            → approved
//   - autonomy "review"          → approved if low-risk, else pending_review
//   - autonomy "manual"          → always pending_review (an admin decides)

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complete } from "@/lib/platform/ai";
import { aiKeyFor, getCampaign } from "./campaigns";
import { campaignContentJobs, campaignPersonas, type CampaignContentJobRow, type CampaignRow } from "./schema";
import { logAudit } from "./audit";

const REVIEW_RISK_THRESHOLD = 40;

export type GateStatus = "approved" | "pending_review" | "blocked";

export function evaluateGate(campaign: CampaignRow, job: { riskScore: number }): { status: GateStatus; reason?: string } {
  if (campaign.status !== "active") return { status: "blocked", reason: `Campaign is ${campaign.status}; activate it first` };
  if (campaign.autonomyMode === "auto") return { status: "approved" };
  if (campaign.autonomyMode === "review") {
    return job.riskScore >= REVIEW_RISK_THRESHOLD ? { status: "pending_review" } : { status: "approved" };
  }
  return { status: "pending_review" }; // manual
}

export function listJobs(orgId: string, campaignId: string) {
  return db
    .select()
    .from(campaignContentJobs)
    .where(and(eq(campaignContentJobs.orgId, orgId), eq(campaignContentJobs.campaignId, campaignId)))
    .orderBy(desc(campaignContentJobs.createdAt));
}

async function getJob(orgId: string, jobId: string): Promise<CampaignContentJobRow | null> {
  const rows = await db.select().from(campaignContentJobs).where(and(eq(campaignContentJobs.orgId, orgId), eq(campaignContentJobs.id, jobId)));
  return rows[0] ?? null;
}

export async function createJob(
  orgId: string,
  userId: string,
  campaignId: string,
  input: { channel: string; brief: string; personaId?: string; riskScore?: number },
): Promise<void> {
  const now = Date.now();
  await db.insert(campaignContentJobs).values({
    id: randomUUID(),
    orgId,
    campaignId,
    personaId: input.personaId || null,
    channel: input.channel,
    brief: input.brief.trim(),
    riskScore: Math.max(0, Math.min(100, input.riskScore ?? 0)),
    status: "draft",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
  await logAudit(orgId, campaignId, userId, "content.created", `${input.channel}: ${input.brief.trim().slice(0, 60)}`);
}

export async function generateJobContent(orgId: string, userId: string, jobId: string): Promise<void> {
  const job = await getJob(orgId, jobId);
  if (!job) throw new Error("Job not found");
  const campaign = await getCampaign(orgId, job.campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const apiKey = await aiKeyFor(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  let personaCtx = "";
  if (job.personaId) {
    // Org-scoped: a job's personaId is client-supplied, so never read a persona
    // outside this tenant.
    const p = (await db.select().from(campaignPersonas).where(and(eq(campaignPersonas.orgId, orgId), eq(campaignPersonas.id, job.personaId))))[0];
    if (p) personaCtx = `\nSender persona: ${p.name}${p.role ? ` (${p.role})` : ""}${p.backstory ? ` — ${p.backstory}` : ""}`;
  }

  const content = await complete(
    [{ role: "user", content: `Channel: ${job.channel}\nCampaign objective: ${campaign.objective || campaign.name}\nBrief: ${job.brief ?? ""}${personaCtx}` }],
    {
      system:
        "You are drafting simulated security-awareness content for an AUTHORIZED training campaign. Output ONLY the message content for the given channel — no preamble or explanation. It must read as a realistic training simulation and stay within ethical, authorized bounds.",
      maxTokens: 700,
      apiKey,
    },
  );

  await db
    .update(campaignContentJobs)
    .set({ generatedContent: content, status: job.status === "draft" ? "generated" : job.status, updatedAt: Date.now() })
    .where(and(eq(campaignContentJobs.orgId, orgId), eq(campaignContentJobs.id, jobId)));
  await logAudit(orgId, job.campaignId, userId, "content.generated", job.channel);
}

// Submit a job through the autonomy gate.
export async function submitJob(orgId: string, userId: string, jobId: string): Promise<void> {
  const job = await getJob(orgId, jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "approved" || job.status === "rejected") return; // terminal
  const campaign = await getCampaign(orgId, job.campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const gate = evaluateGate(campaign, job);
  await db
    .update(campaignContentJobs)
    .set({ status: gate.status, blockReason: gate.reason ?? null, updatedAt: Date.now() })
    .where(and(eq(campaignContentJobs.orgId, orgId), eq(campaignContentJobs.id, jobId)));
  await logAudit(orgId, job.campaignId, userId, `content.submitted.${gate.status}`, gate.reason);
}

export async function decideJob(orgId: string, userId: string, jobId: string, decision: "approved" | "rejected", note?: string): Promise<void> {
  const job = await getJob(orgId, jobId);
  if (!job) return;
  // Atomic guard: only transition a still-pending job, so concurrent decisions
  // can't double-decide / double-audit.
  const updated = await db
    .update(campaignContentJobs)
    .set({ status: decision, decidedByUserId: userId, decidedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(campaignContentJobs.orgId, orgId), eq(campaignContentJobs.id, jobId), eq(campaignContentJobs.status, "pending_review")))
    .returning({ id: campaignContentJobs.id });
  if (!updated.length) return;
  await logAudit(orgId, job.campaignId, userId, `content.${decision}`, note);
}
