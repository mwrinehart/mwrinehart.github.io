// Demo dataset for the Narrative module — a fictional health system facing one
// false viral narrative (breach cover-up), one misleading one (layoffs →
// bankruptcy), and one true story (clinic opening). Idempotent: no-ops if the
// org already has narratives. Follows seedBehaviorDemo's shape.

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import {
  narrativeAlerts,
  narrativeAudit,
  narrativeFacts,
  narrativeMentions,
  narrativeResponses,
  narrativeSources,
  narrativeWatchTerms,
  narratives,
} from "./schema";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export async function seedNarrativeDemo(orgId: string): Promise<void> {
  const existing = await db.select({ id: narratives.id }).from(narratives).where(eq(narratives.orgId, orgId)).limit(1);
  if (existing.length > 0) return;

  const now = Date.now();

  // Watch terms — what the org monitors for.
  for (const term of ["Meridian Health", "Meridian", "Dana Cole"]) {
    await db.insert(narrativeWatchTerms).values({ id: randomUUID(), orgId, term, enabled: true, matchCount: 0, createdAt: now - 30 * DAY });
  }

  // Real, fetchable demo sources (Google News RSS query + reddit search).
  const sources = [
    {
      name: "Google News — Meridian Health",
      url: "https://news.google.com/rss/search?q=%22Meridian%20Health%22",
      kind: "rss",
      platform: "news",
    },
    {
      name: "Reddit search — Meridian Health",
      url: "https://www.reddit.com/search.json?q=%22meridian%20health%22&sort=new",
      kind: "reddit",
      platform: "social",
    },
  ];
  for (const s of sources) {
    await db.insert(narrativeSources).values({ id: randomUUID(), orgId, ...s, enabled: true, createdAt: now - 30 * DAY });
  }

  // Verified fact library — the ground truth assessments anchor to.
  const facts = [
    {
      topic: "Data security",
      statement:
        "Meridian Health has had no patient-data breach in 2025 or 2026. The only security event was a contained phishing attempt in March 2026 that reached zero patient records and was reported to regulators within 24 hours.",
      sourceUrl: "https://example.com/meridian/security-update",
    },
    {
      topic: "Workforce",
      statement:
        "Meridian Health reduced 3% of administrative roles in May 2026 while hiring 120 clinical staff in the same quarter; overall headcount grew.",
      sourceUrl: "https://example.com/meridian/q2-update",
    },
    {
      topic: "Financials",
      statement: "Meridian Health is profitable and its A- credit rating was affirmed in June 2026.",
      sourceUrl: "https://example.com/meridian/investor-relations",
    },
    {
      topic: "Leadership",
      statement: "CEO Dana Cole has led Meridian Health since 2021 and has announced no plans to depart.",
      sourceUrl: null,
    },
    {
      topic: "Facilities",
      statement: "Meridian Health opened a new pediatric clinic in Riverton in June 2026.",
      sourceUrl: "https://example.com/meridian/riverton-clinic",
    },
  ];
  for (const f of facts) {
    await db.insert(narrativeFacts).values({
      id: randomUUID(),
      orgId,
      topic: f.topic,
      statement: f.statement,
      sourceUrl: f.sourceUrl,
      createdByUserId: null,
      createdAt: now - 20 * DAY,
      updatedAt: now - 20 * DAY,
    });
  }

  // ── Narrative 1: FALSE breach cover-up (viral, alerted, response drafted) ──
  const breachId = randomUUID();
  await db.insert(narratives).values({
    id: breachId,
    orgId,
    title: "Alleged cover-up of a massive Meridian Health patient-data breach",
    claim: "Meridian Health suffered a breach of two million patient records and is hiding it from patients and regulators.",
    summary:
      "A claim that Meridian Health is concealing a two-million-record patient-data breach is spreading from a forum post into social media and low-credibility news aggregators, accelerating over the past 48 hours.",
    status: "active",
    verdict: "false",
    verdictConfidence: 88,
    verdictRationale:
      "Directly contradicted by the fact library: Meridian has had no patient-data breach in 2025-2026; the only event was a contained March 2026 phishing attempt reaching zero patient records, reported to regulators within 24 hours. No mention cites any primary evidence.",
    verdictSource: "ai",
    analyzedAt: now - 3 * HOUR,
    threatScore: 73,
    mentionCount: 9,
    totalReach: 7493,
    velocity: 6,
    alertedSeverity: "high",
    firstSeenAt: now - 3 * DAY,
    lastSeenAt: now - 2 * HOUR,
    createdAt: now - 3 * DAY,
    updatedAt: now - 2 * HOUR,
  });

  const breachMentions = [
    { t: "Whistleblower: Meridian Health hiding a 2M-record patient data breach", p: "forum", r: 4200, h: 70, a: "throwaway_hc" },
    { t: "Is Meridian Health covering up a data breach? Thread", p: "social", r: 1800, h: 46, a: "privacywatch22" },
    { t: "Meridian Health breach cover-up allegations spread online", p: "news", r: 900, h: 30, a: null },
    { t: "My data was in the Meridian breach — why has nobody been notified?", p: "social", r: 350, h: 22, a: "concerned_pt" },
    { t: "Meridian Health silent as breach rumors grow", p: "blog", r: 120, h: 18, a: "hcsecblog" },
    { t: "Did Meridian Health get breached? What we know", p: "news", r: 60, h: 12, a: null },
    { t: "Meridian Health cover-up claims resurface on health forums", p: "forum", r: 40, h: 8, a: "medforum_mod" },
    { t: "Meridian breach rumor roundup", p: "social", r: 15, h: 5, a: "aggregator_bot_watch" },
    { t: "Report: no evidence yet for alleged Meridian Health breach", p: "news", r: 8, h: 2, a: null },
  ];
  for (const [i, m] of breachMentions.entries()) {
    await db.insert(narrativeMentions).values({
      id: randomUUID(),
      orgId,
      sourceId: null,
      sourceName: "Sample source",
      platform: m.p,
      url: `https://example.com/mentions/breach-${i}`,
      author: m.a,
      title: m.t,
      excerpt: "Sample mention seeded for the demo scenario.",
      matchedTerms: "Meridian Health",
      reach: m.r,
      narrativeId: breachId,
      publishedAt: now - m.h * HOUR,
      fetchedAt: now - m.h * HOUR,
    });
  }

  await db.insert(narrativeAlerts).values({
    id: randomUUID(),
    orgId,
    narrativeId: breachId,
    severity: "high",
    title: "False narrative spreading: Alleged cover-up of a massive Meridian Health patient-data breach",
    body: "Verdict: false (88% confidence). 9 mentions, reach ~7493, 6 in the last 24h. Threat score 73/100.\nClaim: Meridian Health suffered a breach of two million patient records and is hiding it from patients and regulators.",
    status: "open",
    createdAt: now - 3 * HOUR,
  });

  await db.insert(narrativeResponses).values({
    id: randomUUID(),
    orgId,
    narrativeId: breachId,
    posture: "debunk",
    strategy:
      "The claim is spreading beyond containment (reach ~7.5k, accelerating), so silence now reads as confirmation. Debunk once, plainly, from an attributed company channel, and equip patient-facing staff with the same language. Do not link to or quote the original forum post — that amplifies it.",
    draftMessage:
      "Patient data at Meridian Health is secure. There has been no breach of Meridian patient records — in 2025 and 2026 our systems have had zero patient-data incidents, and independent audits confirm it. A rumor circulating online claims otherwise; it is false, and it cites no evidence. The only security event this year was a phishing attempt in March that was contained the same day, reached zero patient records, and was reported to regulators within 24 hours. Your data is safe, and if that ever changes we will tell you directly and immediately.",
    audience: "Patients and their families; secondarily local press",
    channels: "company newsroom, social media, patient email",
    riskScore: 35,
    status: "pending_review",
    createdByUserId: null,
    createdAt: now - 2 * HOUR,
    updatedAt: now - 2 * HOUR,
  });

  // ── Narrative 2: MISLEADING layoffs → bankruptcy (acknowledged alert) ──────
  const layoffsId = randomUUID();
  await db.insert(narratives).values({
    id: layoffsId,
    orgId,
    title: "Meridian Health layoffs framed as a sign of imminent bankruptcy",
    claim: "Meridian Health's May staff cuts show the system is about to go bankrupt.",
    summary:
      "Coverage of a small administrative restructuring is being reframed as evidence of financial collapse, mostly on business-rumor accounts.",
    status: "active",
    verdict: "misleading",
    verdictConfidence: 74,
    verdictRationale:
      "Kernel of truth (a 3% administrative reduction happened in May 2026) materially distorted: the same quarter added 120 clinical hires, headcount grew overall, and the A- credit rating was affirmed in June 2026 — inconsistent with imminent bankruptcy.",
    verdictSource: "ai",
    analyzedAt: now - DAY,
    threatScore: 52,
    mentionCount: 5,
    totalReach: 1420,
    velocity: 2,
    alertedSeverity: "medium",
    firstSeenAt: now - 6 * DAY,
    lastSeenAt: now - 5 * HOUR,
    createdAt: now - 6 * DAY,
    updatedAt: now - 5 * HOUR,
  });
  const layoffMentions = [
    { t: "Meridian Health layoffs — the beginning of the end?", p: "social", r: 800, h: 96 },
    { t: "Sources say Meridian Health finances worse than reported", p: "blog", r: 400, h: 60 },
    { t: "Meridian cuts staff amid 'restructuring'", p: "news", r: 150, h: 30 },
    { t: "Is Meridian Health going bankrupt after the layoffs?", p: "forum", r: 50, h: 20 },
    { t: "Meridian Health bankruptcy chatter grows", p: "social", r: 20, h: 5 },
  ];
  for (const [i, m] of layoffMentions.entries()) {
    await db.insert(narrativeMentions).values({
      id: randomUUID(),
      orgId,
      sourceId: null,
      sourceName: "Sample source",
      platform: m.p,
      url: `https://example.com/mentions/layoffs-${i}`,
      author: null,
      title: m.t,
      excerpt: "Sample mention seeded for the demo scenario.",
      matchedTerms: "Meridian",
      reach: m.r,
      narrativeId: layoffsId,
      publishedAt: now - m.h * HOUR,
      fetchedAt: now - m.h * HOUR,
    });
  }
  await db.insert(narrativeAlerts).values({
    id: randomUUID(),
    orgId,
    narrativeId: layoffsId,
    severity: "medium",
    title: "False narrative spreading: Meridian Health layoffs framed as a sign of imminent bankruptcy",
    body: "Verdict: misleading (74% confidence). 5 mentions, reach ~1420, 2 in the last 24h. Threat score 52/100.",
    status: "acknowledged",
    acknowledgedByUserId: null,
    acknowledgedAt: now - 20 * HOUR,
    createdAt: now - DAY,
  });

  // ── Narrative 3: TRUE clinic opening (no threat) ───────────────────────────
  const clinicId = randomUUID();
  await db.insert(narratives).values({
    id: clinicId,
    orgId,
    title: "Meridian Health opens new pediatric clinic in Riverton",
    claim: "Meridian Health opened a pediatric clinic in Riverton in June 2026.",
    summary: "Straightforward local coverage of the Riverton pediatric clinic opening; consistent with the fact library.",
    status: "emerging",
    verdict: "true",
    verdictConfidence: 92,
    verdictRationale: "Matches the Facilities fact: the Riverton pediatric clinic opened in June 2026.",
    verdictSource: "ai",
    analyzedAt: now - 2 * DAY,
    threatScore: 5,
    mentionCount: 2,
    totalReach: 90,
    velocity: 0,
    alertedSeverity: null,
    firstSeenAt: now - 4 * DAY,
    lastSeenAt: now - 2 * DAY,
    createdAt: now - 4 * DAY,
    updatedAt: now - 2 * DAY,
  });
  for (let i = 0; i < 2; i++) {
    await db.insert(narrativeMentions).values({
      id: randomUUID(),
      orgId,
      sourceId: null,
      sourceName: "Sample source",
      platform: "news",
      url: `https://example.com/mentions/clinic-${i}`,
      author: null,
      title: i === 0 ? "Meridian Health opens pediatric clinic in Riverton" : "New Riverton clinic welcomes first patients",
      excerpt: "Sample mention seeded for the demo scenario.",
      matchedTerms: "Meridian Health",
      reach: i === 0 ? 70 : 20,
      narrativeId: clinicId,
      publishedAt: now - (4 - i) * DAY,
      fetchedAt: now - (4 - i) * DAY,
    });
  }

  // Audit trail mirroring what the pipeline would have written.
  const auditRows: Array<{ narrativeId: string | null; action: string; detail: string; at: number }> = [
    { narrativeId: breachId, action: "narrative.detected", detail: "Whistleblower: Meridian Health hiding a 2M-record patient d", at: now - 3 * DAY },
    { narrativeId: breachId, action: "narrative.assessed.false", detail: "88% confidence", at: now - 3 * HOUR },
    { narrativeId: breachId, action: "alert.raised.high", detail: "Alleged cover-up of a massive Meridian Health patient-data", at: now - 3 * HOUR },
    { narrativeId: breachId, action: "response.generated", detail: "debunk", at: now - 2 * HOUR },
    { narrativeId: layoffsId, action: "narrative.detected", detail: "Meridian Health layoffs — the beginning of the end?", at: now - 6 * DAY },
    { narrativeId: layoffsId, action: "narrative.assessed.misleading", detail: "74% confidence", at: now - DAY },
    { narrativeId: layoffsId, action: "alert.raised.medium", detail: "Meridian Health layoffs framed as a sign of imminent bankru", at: now - DAY },
    { narrativeId: clinicId, action: "narrative.detected", detail: "Meridian Health opens pediatric clinic in Riverton", at: now - 4 * DAY },
    { narrativeId: clinicId, action: "narrative.assessed.true", detail: "92% confidence", at: now - 2 * DAY },
  ];
  for (const a of auditRows) {
    await db.insert(narrativeAudit).values({
      id: randomUUID(),
      orgId,
      narrativeId: a.narrativeId,
      actorUserId: null,
      action: a.action,
      detail: a.detail,
      createdAt: a.at,
    });
  }
}
