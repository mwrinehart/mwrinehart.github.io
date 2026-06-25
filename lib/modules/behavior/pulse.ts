// Threat Pulse engine (ported from CBM pulse.js + pulseNotifications.js), running
// on the shared platform feed engine (lib/platform/feeds.ts). Manual "scan now"
// fetches each enabled feed, classifies items, dedupes by link, stores findings,
// and auto-routes critical/high findings to Slack/Teams via the unified notifier.
//
// Deferred to the scheduling follow-up: the always-on 15-min scan worker and the
// hourly digest tick (Next.js has no long-running worker — these become a
// platform cron job).

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { classifyItem, scanFeed, severityAtLeast, type KeywordRule, type Severity } from "@/lib/platform/feeds";
import { notify } from "@/lib/platform/notify";
import { pulseAutoRoutes, pulseFeeds, pulseFindings, pulseKeywords } from "./schema";

// Built-in classifier (faithful to CBM's CATEGORY_RULES + SEVERITY_RULES).
// Severity rules carry a floor; category rules only tag.
const DEFAULT_RULES: KeywordRule[] = [
  // severity: critical
  ...["emergency directive", "actively exploited", "mass campaign", "critical zero-day", "catastrophic", "nation-state"].map(
    (term) => ({ term, severityFloor: "critical" as Severity }),
  ),
  // severity: high
  ...["high severity", "active exploit", "cve-", "major breach", "cisa alert", "apt"].map((term) => ({
    term,
    severityFloor: "high" as Severity,
  })),
  // severity: medium
  ...["vulnerab", "phish", "ransom", "breach", "advisory", "malware", "exploit"].map((term) => ({
    term,
    severityFloor: "medium" as Severity,
  })),
  // category tags
  { term: "deepfake", category: "ai-threats" },
  { term: "prompt injection", category: "ai-threats" },
  { term: "llm", category: "ai-threats" },
  { term: "smishing", category: "phishing" },
  { term: "vishing", category: "phishing" },
  { term: "credential", category: "phishing" },
  { term: "training", category: "awareness" },
  { term: "awareness", category: "awareness" },
  { term: "hipaa", category: "regulatory" },
  { term: "gdpr", category: "regulatory" },
  { term: "nist", category: "regulatory" },
  { term: "pci", category: "regulatory" },
  { term: "federal register", category: "regulatory" },
  { term: "lockbit", category: "ransomware" },
  { term: "zero-day", category: "zero-day" },
  { term: "0-day", category: "zero-day" },
  { term: "leak", category: "data-breach" },
  { term: "exfiltrat", category: "data-breach" },
];

// ─── feed CRUD ─────────────────────────────────────────────────────────────────

export function listFeeds(orgId: string) {
  return db.select().from(pulseFeeds).where(eq(pulseFeeds.orgId, orgId));
}

// Lightweight SSRF guard for user-supplied feed URLs. (Full DNS-rebind protection
// — CBM's resolve-time check — is a follow-up.)
function assertSafeFeedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid feed URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Feed URL must be http(s)");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Feed URL host is not allowed");
  }
  return u;
}

export async function addFeed(orgId: string, input: { name: string; url: string; category?: string }): Promise<void> {
  assertSafeFeedUrl(input.url);
  await db.insert(pulseFeeds).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Feed",
    url: input.url.trim(),
    category: input.category ?? null,
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteFeed(orgId: string, id: string): Promise<void> {
  await db.delete(pulseFeeds).where(and(eq(pulseFeeds.orgId, orgId), eq(pulseFeeds.id, id)));
}

export async function setFeedEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(pulseFeeds).set({ enabled }).where(and(eq(pulseFeeds.orgId, orgId), eq(pulseFeeds.id, id)));
}

// ─── keyword CRUD ───────────────────────────────────────────────────────────

export function listKeywords(orgId: string) {
  return db.select().from(pulseKeywords).where(eq(pulseKeywords.orgId, orgId));
}

export async function addKeyword(
  orgId: string,
  input: { term: string; category?: string; severityFloor?: Severity },
): Promise<void> {
  await db.insert(pulseKeywords).values({
    id: randomUUID(),
    orgId,
    term: input.term.trim(),
    category: input.category ?? null,
    severityFloor: input.severityFloor ?? null,
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteKeyword(orgId: string, id: string): Promise<void> {
  await db.delete(pulseKeywords).where(and(eq(pulseKeywords.orgId, orgId), eq(pulseKeywords.id, id)));
}

// ─── auto-routes ───────────────────────────────────────────────────────────

export function listAutoRoutes(orgId: string) {
  return db.select().from(pulseAutoRoutes).where(eq(pulseAutoRoutes.orgId, orgId));
}

export async function addAutoRoute(
  orgId: string,
  input: { name: string; severityMin: Severity; channelProvider: "slack" | "teams"; channelTarget: string; categories?: string },
): Promise<void> {
  await db.insert(pulseAutoRoutes).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Route",
    severityMin: input.severityMin,
    categories: input.categories ?? null,
    channelProvider: input.channelProvider,
    channelTarget: input.channelTarget.trim(),
    enabled: true,
    createdAt: Date.now(),
  });
}

interface Finding {
  title: string;
  link: string;
  summary: string;
  severity: Severity;
  category: string | null;
}

// Push one finding to any matching enabled auto-route.
async function dispatchAutoRoutes(orgId: string, finding: Finding): Promise<void> {
  const routes = (await listAutoRoutes(orgId)).filter((r) => r.enabled);
  for (const route of routes) {
    if (!severityAtLeast(finding.severity, route.severityMin as Severity)) continue;
    if (route.categories) {
      const cats = route.categories.split(",").map((c) => c.trim().toLowerCase());
      if (!finding.category || !cats.includes(finding.category.toLowerCase())) continue;
    }
    const res = await notify({
      orgId,
      channel: route.channelProvider as "slack" | "teams",
      target: route.channelTarget,
      subject: `[${finding.severity.toUpperCase()}] ${finding.title}`,
      body: `${finding.summary}\n${finding.link}`,
      module: "behavior",
    });
    if (res.status === "sent") {
      await db
        .update(pulseAutoRoutes)
        .set({ sentCount: route.sentCount + 1, lastSentAt: Date.now() })
        .where(eq(pulseAutoRoutes.id, route.id));
    }
  }
}

export interface ScanResult {
  scannedFeeds: number;
  added: number;
  errors: string[];
}

// Scan all enabled feeds for an org: classify → dedupe by link → store → route.
export async function scanOrgFeeds(orgId: string): Promise<ScanResult> {
  const feeds = (await listFeeds(orgId)).filter((f) => f.enabled);
  const custom = (await listKeywords(orgId)).filter((k) => k.enabled);
  const rules: KeywordRule[] = [
    ...DEFAULT_RULES,
    ...custom.map((k) => ({ term: k.term, category: k.category ?? undefined, severityFloor: (k.severityFloor as Severity) ?? undefined })),
  ];

  const result: ScanResult = { scannedFeeds: 0, added: 0, errors: [] };

  for (const feed of feeds) {
    try {
      const items = await scanFeed(feed.url, feed.name);
      result.scannedFeeds++;
      for (const item of items) {
        if (!item.link) continue;
        const c = classifyItem(item, rules);
        const inserted = await db
          .insert(pulseFindings)
          .values({
            id: randomUUID(),
            orgId,
            feedId: feed.id,
            feedName: feed.name,
            title: item.title,
            summary: item.summary,
            link: item.link,
            severity: c.severity,
            category: c.categories[0] ?? null,
            keywords: c.matched.join(", ") || null,
            publishedAt: item.publishedAt ? new Date(item.publishedAt).getTime() : null,
            scannedAt: Date.now(),
          })
          .onConflictDoNothing()
          .returning({ id: pulseFindings.id });

        if (inserted.length > 0) {
          result.added++;
          await dispatchAutoRoutes(orgId, {
            title: item.title,
            link: item.link,
            summary: item.summary,
            severity: c.severity,
            category: c.categories[0] ?? null,
          });
        }
      }
      await db.update(pulseFeeds).set({ lastScannedAt: Date.now() }).where(eq(pulseFeeds.id, feed.id));
    } catch (e) {
      result.errors.push(`${feed.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

export function listFindings(orgId: string, limit = 50) {
  return db
    .select()
    .from(pulseFindings)
    .where(eq(pulseFindings.orgId, orgId))
    .orderBy(desc(pulseFindings.scannedAt))
    .limit(limit);
}
