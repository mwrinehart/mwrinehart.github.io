// AI analysis for compliance findings (Horizon's signature feature). Uses the
// shared Anthropic client to summarize a finding and cross-reference it against
// the tenant's own configured policies, returning concrete action items.
//
// Cost-controlled: analysis is a separate step from scanning (manual per-finding,
// bulk "analyze new", or the compliance-analyze cron job — all bounded). Uses the
// org's own Anthropic key (secret `anthropicApiKey`) when set, else the platform
// env key; orgs with neither are skipped.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { complete, orgAnthropicKey } from "@/lib/platform/ai";
import { complianceFindings, compliancePolicies, type CompliancePolicyRow } from "./schema";

export const aiKeyFor = orgAnthropicKey;

interface Analysis {
  summary: string;
  actions: string[];
  policies: Array<{ reference?: string; title?: string; why?: string }>;
}

function policyContext(policies: CompliancePolicyRow[]): string {
  if (policies.length === 0) return "(The organization has not configured any policies.)";
  return policies
    .map((p) => `- ${p.reference ? `[${p.reference}] ` : ""}${p.title}${p.category ? ` (${p.category})` : ""}${p.content ? `: ${p.content.slice(0, 300)}` : ""}`)
    .join("\n");
}

function parseAnalysis(raw: string): Analysis | null {
  // Tolerate code fences / surrounding prose. Returns null on malformed JSON so
  // callers can decide (rather than throwing out of a server action).
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match ? match[0] : raw) as Partial<Analysis>;
    return {
      summary: typeof data.summary === "string" ? data.summary : "",
      actions: Array.isArray(data.actions) ? data.actions.filter((a) => typeof a === "string") : [],
      policies: Array.isArray(data.policies) ? data.policies.filter((p) => p && typeof p === "object") : [],
    };
  } catch {
    return null;
  }
}

const SYSTEM =
  "You are a healthcare/enterprise compliance analyst. Given a security or regulatory finding and the organization's policies, respond with STRICT JSON only (no prose, no code fences) of the shape: " +
  '{"summary": string (2-3 sentences), "actions": string[] (concrete recommended actions), "policies": [{"reference": string, "title": string, "why": string}] (the listed org policies this finding implicates; empty array if none clearly apply)}.';

// Analyze a single finding. Throws if no AI key is available (caller records it).
export async function analyzeFinding(orgId: string, findingId: string): Promise<void> {
  const apiKey = await aiKeyFor(orgId);
  if (!apiKey) throw new Error("No Anthropic API key configured for this org or platform.");

  const finding = (
    await db.select().from(complianceFindings).where(and(eq(complianceFindings.orgId, orgId), eq(complianceFindings.id, findingId)))
  )[0];
  if (!finding) throw new Error("Finding not found");

  const policies = await db.select().from(compliancePolicies).where(eq(compliancePolicies.orgId, orgId));

  const userMsg = [
    `FINDING (severity ${finding.severity}${finding.category ? `, category ${finding.category}` : ""}):`,
    finding.title,
    finding.summary ? `\n${finding.summary}` : "",
    `\n\nORGANIZATION POLICIES:\n${policyContext(policies)}`,
  ].join("");

  const out = await complete([{ role: "user", content: userMsg }], { system: SYSTEM, maxTokens: 700, apiKey });
  const analysis = parseAnalysis(out);
  if (!analysis) throw new Error("AI returned unparseable output");

  await db
    .update(complianceFindings)
    .set({
      aiSummary: analysis.summary || null,
      aiActions: JSON.stringify(analysis.actions),
      mappedPolicies: JSON.stringify(analysis.policies),
      analyzedAt: Date.now(),
    })
    .where(eq(complianceFindings.id, findingId));
}

// Analyze up to `limit` not-yet-analyzed findings for one org.
export async function analyzeNewFindings(orgId: string, limit = 10): Promise<{ analyzed: number; errors: number }> {
  if (!(await aiKeyFor(orgId))) return { analyzed: 0, errors: 0 };
  const pending = await db
    .select({ id: complianceFindings.id })
    .from(complianceFindings)
    .where(and(eq(complianceFindings.orgId, orgId), isNull(complianceFindings.analyzedAt)))
    .limit(limit);
  let analyzed = 0;
  let errors = 0;
  for (const f of pending) {
    try {
      await analyzeFinding(orgId, f.id);
      analyzed++;
    } catch {
      errors++;
    }
  }
  return { analyzed, errors };
}

// Global cron entry: analyze unanalyzed findings across orgs, bounded per run.
export async function analyzeAllOrgs(limit = 25): Promise<{ analyzed: number }> {
  const rows = await db
    .select({ orgId: complianceFindings.orgId })
    .from(complianceFindings)
    .where(isNull(complianceFindings.analyzedAt));
  const orgIds = [...new Set(rows.map((r) => r.orgId))];
  let analyzed = 0;
  for (const orgId of orgIds) {
    if (analyzed >= limit) break;
    const r = await analyzeNewFindings(orgId, limit - analyzed);
    analyzed += r.analyzed;
  }
  return { analyzed };
}
