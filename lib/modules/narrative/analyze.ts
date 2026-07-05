// AI veracity assessment (shared Anthropic client), grounded in the org's fact
// library. Cost-separated from scanning like Compliance: scans are AI-free; the
// assessment runs per-narrative on demand, in bulk from the page, and bounded
// from cron. Analyst verdicts always beat AI ones — the cron only picks up
// narratives that have never been assessed, and slow AI writes are guarded with
// a compare-and-swap so a concurrent human override wins.

import { randomUUID } from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complete, extractJsonObject, orgAnthropicKey } from "@/lib/platform/ai";
import { logAudit } from "./audit";
import { refreshNarratives } from "./alerts";
import { VERDICTS, type Verdict } from "./scoring";
import { narrativeFacts, narrativeMentions, narratives, type NarrativeFactRow } from "./schema";

export const aiKeyFor = orgAnthropicKey;

// ─── fact library ─────────────────────────────────────────────────────────────

export function listFacts(orgId: string) {
  return db.select().from(narrativeFacts).where(eq(narrativeFacts.orgId, orgId)).orderBy(desc(narrativeFacts.updatedAt));
}

export async function addFact(orgId: string, userId: string, input: { topic: string; statement: string; sourceUrl?: string }): Promise<void> {
  const now = Date.now();
  await db.insert(narrativeFacts).values({
    id: randomUUID(),
    orgId,
    topic: input.topic.trim() || "General",
    statement: input.statement.trim(),
    sourceUrl: input.sourceUrl?.trim() || null,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteFact(orgId: string, id: string): Promise<void> {
  await db.delete(narrativeFacts).where(and(eq(narrativeFacts.orgId, orgId), eq(narrativeFacts.id, id)));
}

// Bound the prompt: plenty of grounding without blowing up the context.
const MAX_FACT_CONTEXT = 40;
const MAX_MENTION_CONTEXT = 12;

export function factContext(facts: NarrativeFactRow[]): string {
  if (!facts.length) return "(The organization has not recorded any verified facts yet.)";
  const lines = facts.slice(0, MAX_FACT_CONTEXT).map((f) => `- [${f.topic}] ${f.statement.slice(0, 300)}`);
  if (facts.length > MAX_FACT_CONTEXT) lines.push(`(…and ${facts.length - MAX_FACT_CONTEXT} more facts omitted)`);
  return lines.join("\n");
}

// ─── assessment ───────────────────────────────────────────────────────────────

interface Assessment {
  title: string | null;
  claim: string;
  summary: string;
  verdict: Verdict;
  confidence: number;
  rationale: string;
}

// Tolerates prose/fences around the JSON; returns null (not throw) on garbage.
export function parseAssessment(raw: string): Assessment | null {
  const data = extractJsonObject(raw);
  if (!data) return null;
  const verdict = String(data.verdict ?? "");
  if (!VERDICTS.includes(verdict as Verdict)) return null;
  if (typeof data.claim !== "string" || typeof data.summary !== "string" || typeof data.rationale !== "string") return null;
  const confidence = Number(data.confidence);
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim().slice(0, 200) : null,
    claim: data.claim.trim().slice(0, 1000),
    summary: data.summary.trim().slice(0, 2000),
    verdict: verdict as Verdict,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 0,
    rationale: data.rationale.trim().slice(0, 2000),
  };
}

const SYSTEM =
  'You are a disinformation analyst. You assess a narrative detected across media against an organization\'s verified fact library. ' +
  'Respond with STRICT JSON only — no prose, no code fences — in this exact shape: ' +
  '{"title": string (short neutral name for the narrative), "claim": string (the central factual claim being spread), ' +
  '"summary": string (2-3 sentences: what is spreading, where, and its trajectory), ' +
  '"verdict": "false" | "misleading" | "unsubstantiated" | "true" | "unverified", ' +
  '"confidence": number 0-100, "rationale": string (why, citing which facts support or contradict the claim)}. ' +
  "Verdict rules: 'false' = directly contradicted by the fact library; 'misleading' = a kernel of truth materially distorted; " +
  "'unsubstantiated' = makes strong claims with no support either way; 'true' = consistent with the facts; " +
  "'unverified' = not enough information to judge. Base your judgement ONLY on the provided facts and mentions — never invent facts.";

// Assess one narrative. Throws on missing key / narrative / unparseable output;
// page actions catch and no-op so the UI never 500s (cron retries later).
export async function assessNarrative(orgId: string, narrativeId: string, actorUserId: string | null = null): Promise<void> {
  const rows = await db.select().from(narratives).where(and(eq(narratives.orgId, orgId), eq(narratives.id, narrativeId)));
  const narrative = rows[0];
  if (!narrative) throw new Error("Narrative not found");
  const apiKey = await aiKeyFor(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  const [facts, mentions] = await Promise.all([
    listFacts(orgId),
    db
      .select()
      .from(narrativeMentions)
      .where(and(eq(narrativeMentions.orgId, orgId), eq(narrativeMentions.narrativeId, narrativeId)))
      .orderBy(desc(narrativeMentions.reach), desc(narrativeMentions.fetchedAt))
      .limit(MAX_MENTION_CONTEXT),
  ]);

  const mentionLines = mentions
    .map((m) => `- [${m.platform}${m.reach ? `, reach ~${m.reach}` : ""}] ${m.title}${m.excerpt ? ` — ${m.excerpt.slice(0, 300)}` : ""}`)
    .join("\n");
  const userMsg =
    `Verified fact library:\n${factContext(facts)}\n\n` +
    `Narrative working title: ${narrative.title}\n` +
    `Mentions observed (${narrative.mentionCount} total, showing up to ${MAX_MENTION_CONTEXT}):\n${mentionLines || "(none)"}`;

  const out = await complete([{ role: "user", content: userMsg }], { system: SYSTEM, maxTokens: 700, apiKey });
  const assessment = parseAssessment(out);
  if (!assessment) throw new Error("AI returned unparseable output");

  // Compare-and-swap on analyzedAt: if an analyst set a verdict while the AI
  // call was in flight, their write changed analyzedAt and this update no-ops.
  const prevAnalyzedAt = narrative.analyzedAt;
  const updated = await db
    .update(narratives)
    .set({
      title: assessment.title ?? narrative.title,
      claim: assessment.claim,
      summary: assessment.summary,
      verdict: assessment.verdict,
      verdictConfidence: assessment.confidence,
      verdictRationale: assessment.rationale,
      verdictSource: "ai",
      analyzedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(narratives.orgId, orgId),
        eq(narratives.id, narrativeId),
        sql`${narratives.analyzedAt} IS NOT DISTINCT FROM ${prevAnalyzedAt}`,
      ),
    )
    .returning({ id: narratives.id });
  if (!updated.length) return;

  await logAudit(orgId, narrativeId, actorUserId, `narrative.assessed.${assessment.verdict}`, `${assessment.confidence}% confidence`);
  await refreshNarratives(orgId, [narrativeId]);
}

// Assess narratives that have never been assessed, most-visible first.
export async function assessNewNarratives(orgId: string, limit = 5): Promise<{ assessed: number; errors: number }> {
  if (!(await aiKeyFor(orgId))) return { assessed: 0, errors: 0 };
  const pending = await db
    .select({ id: narratives.id })
    .from(narratives)
    .where(and(eq(narratives.orgId, orgId), isNull(narratives.analyzedAt)))
    .orderBy(desc(narratives.totalReach), desc(narratives.lastSeenAt))
    .limit(limit);
  let assessed = 0;
  let errors = 0;
  for (const row of pending) {
    try {
      await assessNarrative(orgId, row.id);
      assessed++;
    } catch {
      errors++;
    }
  }
  return { assessed, errors };
}

// Cron entry: bounded by ATTEMPTS (successes + errors), not successes, so a
// poisoned org can't burn unbounded API calls.
export async function assessAllOrgs(limit = 15): Promise<{ assessed: number; attempted: number }> {
  const rows = await db.select({ orgId: narratives.orgId }).from(narratives).where(isNull(narratives.analyzedAt));
  const orgIds = [...new Set(rows.map((r) => r.orgId))];
  let assessed = 0;
  let attempted = 0;
  for (const orgId of orgIds) {
    if (attempted >= limit) break;
    try {
      const r = await assessNewNarratives(orgId, Math.max(1, limit - attempted));
      assessed += r.assessed;
      attempted += r.assessed + r.errors;
    } catch {
      attempted++;
    }
  }
  return { assessed, attempted };
}
