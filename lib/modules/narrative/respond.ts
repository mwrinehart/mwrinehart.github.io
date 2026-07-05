// Counter-response engine. The AI drafts a strategy + message grounded in the
// org's verified fact library; the draft then flows through the same human
// gate discipline as Campaigns content jobs: draft → pending_review →
// approved | rejected, with atomic decisions and a full audit trail.
//
// Deliberate constraints (this is a counter-DISinformation tool, not an
// influence-operations tool):
//   * There is no auto-approve mode — every response requires a human decision.
//   * The platform never publishes anything; "approved" hands finished copy to
//     the org's comms team.
//   * The prompt forbids invented facts, sockpuppets, and covert amplification;
//     responses are transparent and attributed to the organization.

import { randomUUID } from "crypto";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complete, extractJsonObject } from "@/lib/platform/ai";
import { notify } from "@/lib/platform/notify";
import { aiKeyFor, factContext, listFacts } from "./analyze";
import { logAudit } from "./audit";
import { narrativeResponses, narratives, type NarrativeResponseRow, type NarrativeRow } from "./schema";

export type ResponsePosture = "debunk" | "prebunk" | "amplify_truth" | "monitor";
export const RESPONSE_POSTURES: ResponsePosture[] = ["debunk", "prebunk", "amplify_truth", "monitor"];

export type ResponseGateStatus = "pending_review" | "blocked";

// Pure gate — unit-tested. Unlike Campaigns there is no "auto" outcome: any
// outward-facing counter-message always requires an explicit human approval.
export function evaluateResponseGate(
  narrative: Pick<NarrativeRow, "status" | "verdict">,
  response: Pick<NarrativeResponseRow, "posture">,
): { status: ResponseGateStatus; reason?: string } {
  if (narrative.status === "dismissed") {
    return { status: "blocked", reason: "Narrative was dismissed; no response should go out." };
  }
  if (response.posture !== "monitor" && narrative.verdict !== "false" && narrative.verdict !== "misleading") {
    return {
      status: "blocked",
      reason: `Counter-messaging requires a false or misleading verdict (current: ${narrative.verdict}). Assess the narrative or override the verdict first.`,
    };
  }
  return { status: "pending_review" };
}

// NaN clamps to 0 so junk risk from a form or the AI can't slip past review.
export function clampRisk(n: number | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

// ─── queries ──────────────────────────────────────────────────────────────────

export function listResponses(orgId: string, limit = 100) {
  return db.select().from(narrativeResponses).where(eq(narrativeResponses.orgId, orgId)).orderBy(desc(narrativeResponses.createdAt)).limit(limit);
}

export function listResponsesForNarrative(orgId: string, narrativeId: string) {
  return db
    .select()
    .from(narrativeResponses)
    .where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.narrativeId, narrativeId)))
    .orderBy(desc(narrativeResponses.createdAt));
}

async function getResponse(orgId: string, id: string): Promise<NarrativeResponseRow | null> {
  const rows = await db.select().from(narrativeResponses).where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.id, id)));
  return rows[0] ?? null;
}

// ─── AI drafting ──────────────────────────────────────────────────────────────

interface ResponseDraft {
  posture: ResponsePosture;
  rationale: string;
  draftMessage: string;
  audience: string | null;
  channels: string[];
  risk: number;
}

export function parseResponseDraft(raw: string): ResponseDraft | null {
  const data = extractJsonObject(raw);
  if (!data) return null;
  const posture = String(data.posture ?? "");
  if (!RESPONSE_POSTURES.includes(posture as ResponsePosture)) return null;
  if (typeof data.rationale !== "string" || typeof data.draftMessage !== "string") return null;
  return {
    posture: posture as ResponsePosture,
    rationale: data.rationale.trim().slice(0, 4000),
    draftMessage: data.draftMessage.trim().slice(0, 4000),
    audience: typeof data.audience === "string" && data.audience.trim() ? data.audience.trim().slice(0, 300) : null,
    channels: Array.isArray(data.channels) ? data.channels.filter((c): c is string => typeof c === "string").slice(0, 8) : [],
    risk: clampRisk(Number(data.risk)),
  };
}

const SYSTEM =
  "You are a counter-disinformation communications strategist drafting a response plan for an organization's communications team. " +
  'Respond with STRICT JSON only — no prose, no code fences — in this exact shape: {"posture": "debunk" | "prebunk" | "amplify_truth" | "monitor", ' +
  '"rationale": string (why this posture, including amplification risk), "draftMessage": string (the message the comms team could publish, in the organization\'s own transparent, attributed voice), ' +
  '"audience": string, "channels": string[] (e.g. "press statement", "company blog", "social media", "customer email"), "risk": number 0-100 (risk that responding backfires or amplifies the narrative)}. ' +
  "Rules: ground every factual statement ONLY in the provided fact library — never invent facts. Structure the draft as a truth sandwich: lead with the truth, " +
  "flag the falsehood once without repeating its wording, and close by restating the truth. If the narrative's spread is still small, prefer posture \"monitor\" and say why responding now would amplify it. " +
  "Never suggest fake personas, sockpuppets, astroturfing, bot networks, or any covert amplification — responses are always transparent and attributed to the organization. " +
  "This draft goes to human review; nothing is auto-published.";

// Draft a counter-response for a narrative. Throws on missing key / narrative /
// unparseable output; page actions catch so the UI degrades gracefully.
export async function generateResponse(orgId: string, userId: string, narrativeId: string): Promise<void> {
  const rows = await db.select().from(narratives).where(and(eq(narratives.orgId, orgId), eq(narratives.id, narrativeId)));
  const narrative = rows[0];
  if (!narrative) throw new Error("Narrative not found");
  const apiKey = await aiKeyFor(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  const facts = await listFacts(orgId);
  const userMsg =
    `Verified fact library:\n${factContext(facts)}\n\n` +
    `Narrative: ${narrative.title}\n` +
    `Central claim: ${narrative.claim ?? "(not yet extracted)"}\n` +
    `Verdict: ${narrative.verdict} (${narrative.verdictConfidence}% confidence)\n` +
    `Assessment rationale: ${narrative.verdictRationale ?? "(none)"}\n` +
    `Spread: ${narrative.mentionCount} mentions, reach ~${narrative.totalReach}, ${narrative.velocity} in the last 24h, threat score ${narrative.threatScore}/100.`;

  const out = await complete([{ role: "user", content: userMsg }], { system: SYSTEM, maxTokens: 900, apiKey });
  const draft = parseResponseDraft(out);
  if (!draft) throw new Error("AI returned unparseable output");

  await db.insert(narrativeResponses).values({
    id: randomUUID(),
    orgId,
    narrativeId,
    posture: draft.posture,
    strategy: draft.rationale,
    draftMessage: draft.draftMessage,
    audience: draft.audience,
    channels: draft.channels.join(", ") || null,
    riskScore: draft.risk,
    status: "draft",
    createdByUserId: userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await logAudit(orgId, narrativeId, userId, "response.generated", draft.posture);
}

// Human edits to the draft before submission — only while it is still a draft.
export async function updateResponseDraft(
  orgId: string,
  userId: string,
  id: string,
  patch: { draftMessage?: string; audience?: string },
): Promise<void> {
  const updated = await db
    .update(narrativeResponses)
    .set({
      ...(patch.draftMessage !== undefined ? { draftMessage: patch.draftMessage.trim().slice(0, 4000) } : {}),
      ...(patch.audience !== undefined ? { audience: patch.audience.trim().slice(0, 300) || null } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.id, id), eq(narrativeResponses.status, "draft")))
    .returning({ narrativeId: narrativeResponses.narrativeId });
  if (updated.length) await logAudit(orgId, updated[0].narrativeId, userId, "response.edited");
}

// Submit a draft through the gate. Terminal states are never reopened — the
// UPDATE re-checks status atomically so a submit racing an admin decision
// can't flip an approved/rejected response back to pending_review.
export async function submitResponse(orgId: string, userId: string, id: string): Promise<void> {
  const response = await getResponse(orgId, id);
  if (!response) return;
  if (response.status === "approved" || response.status === "rejected") return;
  const rows = await db.select().from(narratives).where(and(eq(narratives.orgId, orgId), eq(narratives.id, response.narrativeId)));
  const narrative = rows[0];
  if (!narrative) return;
  const gate = evaluateResponseGate(narrative, response);
  const updated = await db
    .update(narrativeResponses)
    .set({ status: gate.status, blockReason: gate.reason ?? null, updatedAt: Date.now() })
    .where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.id, id), notInArray(narrativeResponses.status, ["approved", "rejected"])))
    .returning({ id: narrativeResponses.id });
  if (!updated.length) return;
  await logAudit(orgId, response.narrativeId, userId, `response.submitted.${gate.status}`, gate.reason);
}

// Admin decision (role enforced at the server-action layer). Atomic on
// pending_review so concurrent decisions can't double-decide or double-audit.
export async function decideResponse(
  orgId: string,
  userId: string,
  id: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<void> {
  const response = await getResponse(orgId, id);
  if (!response) return;
  const updated = await db
    .update(narrativeResponses)
    .set({ status: decision, decidedByUserId: userId, decisionNote: note ?? null, decidedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.id, id), eq(narrativeResponses.status, "pending_review")))
    .returning({ id: narrativeResponses.id });
  if (!updated.length) return;
  await logAudit(orgId, response.narrativeId, userId, `response.${decision}`, note);
  if (decision === "approved") {
    // Best-effort heads-up so comms can pick the approved copy up immediately.
    await notify({
      orgId,
      channel: "slack",
      subject: "Counter-response approved",
      body: `Posture: ${response.posture}. The approved draft is ready for the communications team in the Narrative module.`,
      module: "narrative",
    });
  }
}
