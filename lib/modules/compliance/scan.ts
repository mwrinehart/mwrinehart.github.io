// Compliance scanning (rebuilt from Horizon Scanner) on the shared platform feed
// engine. Tenants add their own feeds + policies (empty by default); "Scan now"
// and the compliance-scan cron job fetch enabled feeds, classify items with a
// compliance-flavored ruleset, dedupe by link, and store findings.

import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { assertSafeFeedUrl, classifyItem, scanFeed, severityAtLeast, type FeedItem, type KeywordRule, type Severity } from "@/lib/platform/feeds";
import { notify } from "@/lib/platform/notify";
import { buildPreferenceModel, scoreFinding } from "./scoring";
import { connectorLabel, fetchConnectorItems, listEnabledConnectors, markConnectorScanned } from "./connectors";
import { complianceAutoRoutes, complianceConnectors, complianceFeeds, complianceFindings, complianceKeywords, compliancePolicies } from "./schema";

// Built-in compliance/regulatory classifier. Tenants don't have to configure
// keywords; these give scanned items sensible severity + category out of the box.
const DEFAULT_RULES: KeywordRule[] = [
  ...["actively exploited", "emergency directive", "mass exploitation", "nation-state", "critical zero-day"].map((term) => ({
    term,
    severityFloor: "critical" as Severity,
  })),
  ...["cisa alert", "binding operational directive", "cve-", "active exploit", "breach notification", "enforcement action"].map((term) => ({
    term,
    severityFloor: "high" as Severity,
  })),
  ...["vulnerab", "advisory", "guidance", "rulemaking", "proposed rule", "final rule", "settlement", "penalty"].map((term) => ({
    term,
    severityFloor: "medium" as Severity,
  })),
  { term: "hipaa", category: "HIPAA" },
  { term: "hitech", category: "HIPAA" },
  { term: "nist", category: "NIST" },
  { term: "800-53", category: "NIST" },
  { term: "pci", category: "PCI-DSS" },
  { term: "gdpr", category: "Privacy" },
  { term: "ccpa", category: "Privacy" },
  { term: "ferpa", category: "Privacy" },
  { term: "sec ", category: "SEC" },
  { term: "ftc", category: "FTC" },
  { term: "federal register", category: "Regulatory" },
  { term: "oig", category: "OIG" },
  { term: "ransomware", category: "Threat" },
  { term: "phishing", category: "Threat" },
];

// ─── feeds ────────────────────────────────────────────────────────────────────

export function listFeeds(orgId: string) {
  return db.select().from(complianceFeeds).where(eq(complianceFeeds.orgId, orgId)).orderBy(desc(complianceFeeds.createdAt));
}

export async function addFeed(orgId: string, input: { name: string; url: string; category?: string }): Promise<void> {
  await assertSafeFeedUrl(input.url);
  await db.insert(complianceFeeds).values({
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
  await db.delete(complianceFeeds).where(and(eq(complianceFeeds.orgId, orgId), eq(complianceFeeds.id, id)));
}

export async function setFeedEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(complianceFeeds).set({ enabled }).where(and(eq(complianceFeeds.orgId, orgId), eq(complianceFeeds.id, id)));
}

// ─── policies ─────────────────────────────────────────────────────────────────

export function listPolicies(orgId: string) {
  return db.select().from(compliancePolicies).where(eq(compliancePolicies.orgId, orgId)).orderBy(desc(compliancePolicies.updatedAt));
}

export async function addPolicy(
  orgId: string,
  input: { title: string; reference?: string; category?: string; content?: string },
): Promise<void> {
  const now = Date.now();
  await db.insert(compliancePolicies).values({
    id: randomUUID(),
    orgId,
    title: input.title.trim(),
    reference: input.reference ?? null,
    category: input.category ?? null,
    content: input.content ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deletePolicy(orgId: string, id: string): Promise<void> {
  await db.delete(compliancePolicies).where(and(eq(compliancePolicies.orgId, orgId), eq(compliancePolicies.id, id)));
}

// ─── custom keywords ──────────────────────────────────────────────────────────

export function listKeywords(orgId: string) {
  return db.select().from(complianceKeywords).where(eq(complianceKeywords.orgId, orgId)).orderBy(desc(complianceKeywords.createdAt));
}

export async function addKeyword(
  orgId: string,
  input: { term: string; category?: string; severityFloor?: Severity },
): Promise<void> {
  await db.insert(complianceKeywords).values({
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
  await db.delete(complianceKeywords).where(and(eq(complianceKeywords.orgId, orgId), eq(complianceKeywords.id, id)));
}

export async function setKeywordEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(complianceKeywords).set({ enabled }).where(and(eq(complianceKeywords.orgId, orgId), eq(complianceKeywords.id, id)));
}

// ─── alert auto-routes ────────────────────────────────────────────────────────

export function listAutoRoutes(orgId: string) {
  return db.select().from(complianceAutoRoutes).where(eq(complianceAutoRoutes.orgId, orgId)).orderBy(desc(complianceAutoRoutes.createdAt));
}

export async function addAutoRoute(
  orgId: string,
  input: { name: string; severityMin: Severity; channelProvider: "slack" | "teams" | "email"; channelTarget: string; categories?: string },
): Promise<void> {
  await db.insert(complianceAutoRoutes).values({
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

export async function deleteAutoRoute(orgId: string, id: string): Promise<void> {
  await db.delete(complianceAutoRoutes).where(and(eq(complianceAutoRoutes.orgId, orgId), eq(complianceAutoRoutes.id, id)));
}

export async function setAutoRouteEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(complianceAutoRoutes).set({ enabled }).where(and(eq(complianceAutoRoutes.orgId, orgId), eq(complianceAutoRoutes.id, id)));
}

interface AlertFinding {
  title: string;
  link: string;
  summary: string;
  severity: Severity;
  category: string | null;
}

type AutoRoute = Awaited<ReturnType<typeof listAutoRoutes>>[number];

// Cap alerts per scan so a first scan / backlog can't trigger a notification
// storm. `budget` is shared across the whole scan run.
const MAX_ALERTS_PER_SCAN = 25;

async function dispatchAutoRoutes(routes: AutoRoute[], orgId: string, finding: AlertFinding, budget: { remaining: number }): Promise<void> {
  for (const route of routes) {
    if (budget.remaining <= 0) return;
    if (!severityAtLeast(finding.severity, route.severityMin as Severity)) continue;
    if (route.categories) {
      const cats = route.categories.split(",").map((c) => c.trim().toLowerCase());
      if (!finding.category || !cats.includes(finding.category.toLowerCase())) continue;
    }
    const res = await notify({
      orgId,
      channel: route.channelProvider as "slack" | "teams" | "email",
      target: route.channelTarget,
      subject: `[${finding.severity.toUpperCase()}] ${finding.title}`,
      body: `${finding.summary}\n${finding.link}`,
      module: "compliance",
    });
    if (res.status === "sent") {
      budget.remaining--;
      // SQL increment avoids the stale-read lost-update across many findings / concurrent scans.
      await db
        .update(complianceAutoRoutes)
        .set({ sentCount: sql`${complianceAutoRoutes.sentCount} + 1`, lastSentAt: Date.now() })
        .where(eq(complianceAutoRoutes.id, route.id));
    }
  }
}

// ─── findings + scan ──────────────────────────────────────────────────────────

export function listFindings(orgId: string, limit = 50) {
  return db
    .select()
    .from(complianceFindings)
    .where(eq(complianceFindings.orgId, orgId))
    .orderBy(desc(complianceFindings.score), desc(complianceFindings.scannedAt))
    .limit(limit);
}

export interface ScanResult {
  scannedFeeds: number;
  added: number;
  errors: string[];
}

export async function scanOrgComplianceFeeds(orgId: string): Promise<ScanResult> {
  const feeds = (await listFeeds(orgId)).filter((f) => f.enabled);
  const connectors = await listEnabledConnectors(orgId);
  const result: ScanResult = { scannedFeeds: 0, added: 0, errors: [] };

  // Tenant tuning: custom keywords augment the built-in classifier, and the
  // preference model (from past votes) tilts the composite score.
  const custom = (await listKeywords(orgId)).filter((k) => k.enabled);
  const rules: KeywordRule[] = [
    ...DEFAULT_RULES,
    ...custom.map((k) => ({ term: k.term, category: k.category ?? undefined, severityFloor: (k.severityFloor as Severity) ?? undefined })),
  ];
  const customByTerm = new Map(custom.map((k) => [k.term.toLowerCase(), k.id]));
  const matchTally = new Map<string, number>(); // keyword id → times matched
  const model = await buildPreferenceModel(orgId);
  const now = Date.now();

  // Auto-routes are static for the scan — fetch once, and share an alert budget
  // across all findings so a backlog can't storm channels.
  const routes = (await listAutoRoutes(orgId)).filter((r) => r.enabled);
  const alertBudget = { remaining: MAX_ALERTS_PER_SCAN };

  // Shared per-item ingestion used by both RSS feeds and connectors.
  const ingest = async (feedId: string | null, sourceName: string, items: FeedItem[]) => {
    for (const item of items) {
      if (!item.link) continue;
      const c = classifyItem(item, rules);
      const parsedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
      const publishedAt = parsedAt != null && Number.isFinite(parsedAt) ? parsedAt : null;
      const score = scoreFinding(
        { severity: c.severity, category: c.categories[0] ?? null, feedName: sourceName, matched: c.matched, publishedAt },
        model,
        now,
      );
      const inserted = await db
        .insert(complianceFindings)
        .values({
          id: randomUUID(),
          orgId,
          feedId,
          feedName: sourceName,
          title: item.title,
          summary: item.summary,
          link: item.link,
          severity: c.severity,
          category: c.categories[0] ?? null,
          keywords: c.matched.join(", ") || null,
          publishedAt,
          scannedAt: now,
          score,
        })
        .onConflictDoNothing()
        .returning({ id: complianceFindings.id });
      if (inserted.length > 0) {
        result.added++;
        for (const term of c.matched) {
          const id = customByTerm.get(term.toLowerCase());
          if (id) matchTally.set(id, (matchTally.get(id) ?? 0) + 1);
        }
        await dispatchAutoRoutes(routes, orgId, {
          title: item.title,
          link: item.link,
          summary: item.summary,
          severity: c.severity,
          category: c.categories[0] ?? null,
        }, alertBudget);
      }
    }
  };

  for (const feed of feeds) {
    try {
      const items = await scanFeed(feed.url, feed.name);
      result.scannedFeeds++;
      await ingest(feed.id, feed.name, items);
      await db.update(complianceFeeds).set({ lastScannedAt: now, lastError: null }).where(eq(complianceFeeds.id, feed.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${feed.name}: ${msg}`);
      await db.update(complianceFeeds).set({ lastScannedAt: now, lastError: msg }).where(eq(complianceFeeds.id, feed.id));
    }
  }

  for (const conn of connectors) {
    const label = connectorLabel(conn.type);
    try {
      const items = await fetchConnectorItems(conn.type, conn.config);
      result.scannedFeeds++;
      await ingest(null, label, items);
      await markConnectorScanned(orgId, conn.type, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${label}: ${msg}`);
      await markConnectorScanned(orgId, conn.type, msg);
    }
  }

  // Persist how often each custom keyword fired (visible on the Keywords tab).
  // SQL increment avoids the stale start-of-scan read clobbering concurrent scans.
  for (const [id, count] of matchTally) {
    await db
      .update(complianceKeywords)
      .set({ matchCount: sql`${complianceKeywords.matchCount} + ${count}` })
      .where(and(eq(complianceKeywords.orgId, orgId), eq(complianceKeywords.id, id)));
  }

  return result;
}

// Global scan across every org with an enabled feed — driven by the
// compliance-scan cron job.
export async function scanAllComplianceOrgs(): Promise<{ orgs: number; added: number }> {
  const [feeds, conns] = await Promise.all([
    db.select({ orgId: complianceFeeds.orgId }).from(complianceFeeds).where(eq(complianceFeeds.enabled, true)),
    db.select({ orgId: complianceConnectors.orgId }).from(complianceConnectors).where(eq(complianceConnectors.enabled, true)),
  ]);
  const orgIds = [...new Set([...feeds.map((f) => f.orgId), ...conns.map((c) => c.orgId)])];
  let added = 0;
  for (const orgId of orgIds) {
    try {
      const r = await scanOrgComplianceFeeds(orgId);
      added += r.added;
    } catch {
      // Isolate per-org failures so one org doesn't abort the rest of the tick.
    }
  }
  return { orgs: orgIds.length, added };
}
