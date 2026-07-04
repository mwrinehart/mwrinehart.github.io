// Narrative scanning: fetch enabled media sources (RSS via the shared platform
// feed engine, reddit via its public JSON listings), keep only items matching
// the org's watch terms, dedupe by URL, cluster mentions into narratives, and
// hand the affected narratives to the alert pass. AI verdicts happen separately
// in analyze.ts (cost-separated, like Compliance).

import { randomUUID } from "crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { assertSafeFeedUrl, scanFeed, MAX_FEED_ITEMS } from "@/lib/platform/feeds";
import { logAudit } from "./audit";
import { refreshNarratives } from "./alerts";
import { bestMatch, matchedWatchTerms } from "./cluster";
import { VERDICTS, type Verdict } from "./scoring";
import { narrativeAlerts, narrativeMentions, narrativeResponses, narrativeSources, narrativeWatchTerms, narratives } from "./schema";

export type SourceKind = "rss" | "reddit";
export type SourcePlatform = "news" | "social" | "blog" | "forum" | "other";

export const SOURCE_KINDS: SourceKind[] = ["rss", "reddit"];
export const SOURCE_PLATFORMS: SourcePlatform[] = ["news", "social", "blog", "forum", "other"];

// ─── sources ──────────────────────────────────────────────────────────────────

export function listSources(orgId: string) {
  return db.select().from(narrativeSources).where(eq(narrativeSources.orgId, orgId)).orderBy(desc(narrativeSources.createdAt));
}

export async function addSource(
  orgId: string,
  input: { name: string; url: string; kind: SourceKind; platform: SourcePlatform },
): Promise<void> {
  await assertSafeFeedUrl(input.url);
  await db.insert(narrativeSources).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Source",
    url: input.url.trim(),
    kind: input.kind,
    platform: input.platform,
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteSource(orgId: string, id: string): Promise<void> {
  await db.delete(narrativeSources).where(and(eq(narrativeSources.orgId, orgId), eq(narrativeSources.id, id)));
}

export async function setSourceEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(narrativeSources).set({ enabled }).where(and(eq(narrativeSources.orgId, orgId), eq(narrativeSources.id, id)));
}

// ─── watch terms ──────────────────────────────────────────────────────────────

export function listWatchTerms(orgId: string) {
  return db.select().from(narrativeWatchTerms).where(eq(narrativeWatchTerms.orgId, orgId)).orderBy(desc(narrativeWatchTerms.createdAt));
}

export async function addWatchTerm(orgId: string, term: string): Promise<void> {
  const trimmed = term.trim();
  if (!trimmed) return;
  await db.insert(narrativeWatchTerms).values({ id: randomUUID(), orgId, term: trimmed, enabled: true, createdAt: Date.now() });
}

export async function deleteWatchTerm(orgId: string, id: string): Promise<void> {
  await db.delete(narrativeWatchTerms).where(and(eq(narrativeWatchTerms.orgId, orgId), eq(narrativeWatchTerms.id, id)));
}

export async function setWatchTermEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(narrativeWatchTerms).set({ enabled }).where(and(eq(narrativeWatchTerms.orgId, orgId), eq(narrativeWatchTerms.id, id)));
}

// ─── narratives + mentions ────────────────────────────────────────────────────

export function listNarratives(orgId: string, limit = 50) {
  return db
    .select()
    .from(narratives)
    .where(eq(narratives.orgId, orgId))
    .orderBy(desc(narratives.threatScore), desc(narratives.lastSeenAt))
    .limit(limit);
}

export async function getNarrative(orgId: string, id: string) {
  const rows = await db.select().from(narratives).where(and(eq(narratives.orgId, orgId), eq(narratives.id, id)));
  return rows[0] ?? null;
}

export function listMentions(orgId: string, narrativeId: string, limit = 100) {
  return db
    .select()
    .from(narrativeMentions)
    .where(and(eq(narrativeMentions.orgId, orgId), eq(narrativeMentions.narrativeId, narrativeId)))
    .orderBy(desc(narrativeMentions.fetchedAt))
    .limit(limit);
}

const ANALYST_STATUSES = new Set(["active", "countered", "dismissed"]);

// Analyst status control (dismiss noise, mark a narrative countered, reopen).
// Invalid values from the form cast are a silent no-op, like Campaigns personas.
export async function setNarrativeStatus(orgId: string, userId: string, id: string, status: string): Promise<void> {
  if (!ANALYST_STATUSES.has(status)) return;
  const updated = await db
    .update(narratives)
    // Reactivation resets the alert high-water mark so a resurging narrative
    // can alert again at its current severity instead of only on escalation
    // past the level it reached before it was dismissed/countered.
    .set({ status, updatedAt: Date.now(), ...(status === "active" ? { alertedSeverity: null } : {}) })
    .where(and(eq(narratives.orgId, orgId), eq(narratives.id, id)))
    .returning({ id: narratives.id });
  if (!updated.length) return;
  await logAudit(orgId, id, userId, `narrative.status.${status}`);
  if (status === "active") await refreshNarratives(orgId, [id]);
}

// Analyst verdict override — human judgement beats the AI assessment. Re-runs
// the scoring/alert pass because the verdict is the main threat input.
export async function setNarrativeVerdict(orgId: string, userId: string, id: string, verdict: Verdict, rationale?: string): Promise<void> {
  if (!VERDICTS.includes(verdict)) return;
  const updated = await db
    .update(narratives)
    .set({
      verdict,
      verdictConfidence: 100,
      verdictRationale: rationale?.trim() || null,
      verdictSource: "analyst",
      analyzedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(and(eq(narratives.orgId, orgId), eq(narratives.id, id)))
    .returning({ id: narratives.id });
  if (!updated.length) return;
  await logAudit(orgId, id, userId, `narrative.verdict.${verdict}`, rationale?.slice(0, 60));
  await refreshNarratives(orgId, [id]);
}

// Cheap counts for the cross-module dashboard.
export async function narrativeOverview(
  orgId: string,
): Promise<{ narratives: number; activeFalse: number; openAlerts: number; pendingResponses: number }> {
  const [tot] = await db.select({ n: sql<number>`count(*)` }).from(narratives).where(eq(narratives.orgId, orgId));
  const [falseN] = await db
    .select({ n: sql<number>`count(*)` })
    .from(narratives)
    .where(
      and(eq(narratives.orgId, orgId), inArray(narratives.verdict, ["false", "misleading"]), notInArray(narratives.status, ["dismissed", "countered"])),
    );
  const [alerts] = await db
    .select({ n: sql<number>`count(*)` })
    .from(narrativeAlerts)
    .where(and(eq(narrativeAlerts.orgId, orgId), eq(narrativeAlerts.status, "open")));
  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(narrativeResponses)
    .where(and(eq(narrativeResponses.orgId, orgId), eq(narrativeResponses.status, "pending_review")));
  return {
    narratives: Number(tot?.n ?? 0),
    activeFalse: Number(falseN?.n ?? 0),
    openAlerts: Number(alerts?.n ?? 0),
    pendingResponses: Number(pending?.n ?? 0),
  };
}

// ─── fetchers ─────────────────────────────────────────────────────────────────

// Normalized shape both fetchers produce; the reddit fetcher carries real
// engagement counts as a reach estimate, RSS items carry 0.
interface MentionItem {
  title: string;
  link: string;
  excerpt: string;
  publishedAt: number | null;
  author: string | null;
  reach: number;
}

function parseEpoch(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

async function fetchRssItems(url: string, sourceName: string): Promise<MentionItem[]> {
  const items = await scanFeed(url, sourceName);
  return items.map((it) => ({
    title: it.title,
    link: it.link,
    excerpt: it.summary,
    publishedAt: parseEpoch(it.publishedAt),
    author: null,
    reach: 0,
  }));
}

// Public reddit JSON listing (search.json, /r/<sub>/new.json, ...). Same SSRF
// guard + timeout discipline as the compliance connectors.
async function fetchRedditItems(url: string): Promise<MentionItem[]> {
  const safe = await assertSafeFeedUrl(url);
  const res = await fetch(safe.toString(), {
    headers: { accept: "application/json", "user-agent": "jericho-platform/narrative-monitor" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Reddit fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { children?: Array<{ data?: Record<string, unknown> }> } };
  const children = Array.isArray(body?.data?.children) ? body.data!.children! : [];
  const items: MentionItem[] = [];
  for (const child of children.slice(0, MAX_FEED_ITEMS)) {
    const d = child?.data;
    if (!d || typeof d.title !== "string" || !d.title.trim()) continue;
    const permalink = typeof d.permalink === "string" ? d.permalink : "";
    const link = permalink ? `https://www.reddit.com${permalink}` : typeof d.url === "string" ? d.url : "";
    if (!link) continue;
    const createdUtc = Number(d.created_utc);
    const score = Number(d.score);
    const comments = Number(d.num_comments);
    items.push({
      title: d.title.trim().slice(0, 300),
      link,
      excerpt: (typeof d.selftext === "string" ? d.selftext : "").trim().slice(0, 2000),
      publishedAt: Number.isFinite(createdUtc) ? Math.round(createdUtc * 1000) : null,
      author: typeof d.author === "string" && d.author ? d.author : null,
      reach: (Number.isFinite(score) ? Math.max(0, score) : 0) + (Number.isFinite(comments) ? Math.max(0, comments) : 0) * 2,
    });
  }
  return items;
}

// ─── scan pipeline ────────────────────────────────────────────────────────────

export interface ScanResult {
  scannedSources: number;
  mentionsAdded: number;
  narrativesCreated: number;
  alerts: number;
  errors: string[];
}

export async function scanOrgNarrativeSources(orgId: string): Promise<ScanResult> {
  const result: ScanResult = { scannedSources: 0, mentionsAdded: 0, narrativesCreated: 0, alerts: 0, errors: [] };
  const sources = (await listSources(orgId)).filter((s) => s.enabled);
  const terms = (await listWatchTerms(orgId)).filter((t) => t.enabled);
  if (!terms.length) {
    result.errors.push("No watch terms configured — add terms (org name, products, executives) so scans know what to look for.");
    return result;
  }
  const termStrings = terms.map((t) => t.term);
  const termIdByLower = new Map(terms.map((t) => [t.term.toLowerCase(), t.id]));
  const matchTally = new Map<string, number>();
  const now = Date.now();

  // Cluster candidates: recent, non-dismissed narratives. New narratives created
  // during this scan are appended so later items in the same run cluster onto them.
  const candidateRows = await db
    .select({ id: narratives.id, title: narratives.title, claim: narratives.claim, summary: narratives.summary })
    .from(narratives)
    .where(and(eq(narratives.orgId, orgId), notInArray(narratives.status, ["dismissed"])))
    .orderBy(desc(narratives.lastSeenAt))
    .limit(200);
  const candidates = candidateRows.map((n) => ({ id: n.id, text: `${n.title} ${n.claim ?? ""} ${n.summary ?? ""}` }));
  const affected = new Set<string>();

  const ingest = async (source: { id: string; name: string; platform: string }, items: MentionItem[]) => {
    for (const item of items) {
      if (!item.link) continue;
      const text = `${item.title} ${item.excerpt}`;
      const matched = matchedWatchTerms(text, termStrings);
      if (!matched.length) continue;

      const inserted = await db
        .insert(narrativeMentions)
        .values({
          id: randomUUID(),
          orgId,
          sourceId: source.id,
          sourceName: source.name,
          platform: source.platform,
          url: item.link,
          author: item.author,
          title: item.title,
          excerpt: item.excerpt || null,
          matchedTerms: matched.join(", "),
          reach: item.reach,
          narrativeId: null,
          publishedAt: item.publishedAt,
          fetchedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: narrativeMentions.id });

      let mentionId: string;
      if (inserted.length) {
        mentionId = inserted[0].id;
        result.mentionsAdded++;
        for (const term of matched) {
          const id = termIdByLower.get(term.toLowerCase());
          if (id) matchTally.set(id, (matchTally.get(id) ?? 0) + 1);
        }
      } else {
        // Deduped by (org_id, url). Self-heal a mention orphaned by a crash
        // between its insert and the narrative attachment below — otherwise
        // the dedupe would skip it on every future scan and it would never be
        // clustered, listed, or counted.
        const existing = (
          await db
            .select({ id: narrativeMentions.id, narrativeId: narrativeMentions.narrativeId })
            .from(narrativeMentions)
            .where(and(eq(narrativeMentions.orgId, orgId), eq(narrativeMentions.url, item.link)))
        )[0];
        if (!existing || existing.narrativeId) continue;
        mentionId = existing.id;
      }

      // Attach to the closest existing narrative or start a new one.
      let narrativeId = bestMatch(text, candidates);
      if (!narrativeId) {
        narrativeId = randomUUID();
        await db.insert(narratives).values({
          id: narrativeId,
          orgId,
          title: item.title.slice(0, 200),
          status: "emerging",
          verdict: "unverified",
          firstSeenAt: item.publishedAt ?? now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
        candidates.push({ id: narrativeId, text });
        result.narrativesCreated++;
        await logAudit(orgId, narrativeId, null, "narrative.detected", item.title.slice(0, 60));
      }
      await db.update(narrativeMentions).set({ narrativeId }).where(eq(narrativeMentions.id, mentionId));
      affected.add(narrativeId);
    }
  };

  for (const source of sources) {
    try {
      const items = source.kind === "reddit" ? await fetchRedditItems(source.url) : await fetchRssItems(source.url, source.name);
      result.scannedSources++;
      await ingest(source, items);
      await db.update(narrativeSources).set({ lastScannedAt: now, lastError: null }).where(eq(narrativeSources.id, source.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${source.name}: ${msg}`);
      await db.update(narrativeSources).set({ lastScannedAt: now, lastError: msg }).where(eq(narrativeSources.id, source.id));
    }
  }

  // Persist watch-term hit counts (SQL increments — no stale read-modify-write).
  for (const [id, count] of matchTally) {
    await db
      .update(narrativeWatchTerms)
      .set({ matchCount: sql`${narrativeWatchTerms.matchCount} + ${count}` })
      .where(and(eq(narrativeWatchTerms.orgId, orgId), eq(narrativeWatchTerms.id, id)));
  }

  const refresh = await refreshNarratives(orgId, [...affected]);
  result.alerts = refresh.alerts;
  return result;
}

// Global scan across every org with an enabled source — the narrative-scan cron.
export async function scanAllNarrativeOrgs(): Promise<{ orgs: number; mentionsAdded: number; alerts: number }> {
  const rows = await db.select({ orgId: narrativeSources.orgId }).from(narrativeSources).where(eq(narrativeSources.enabled, true));
  const orgIds = [...new Set(rows.map((r) => r.orgId))];
  let mentionsAdded = 0;
  let alerts = 0;
  for (const orgId of orgIds) {
    try {
      const r = await scanOrgNarrativeSources(orgId);
      mentionsAdded += r.mentionsAdded;
      alerts += r.alerts;
    } catch {
      // Isolate per-org failures so one org doesn't abort the rest of the tick.
    }
  }
  return { orgs: orgIds.length, mentionsAdded, alerts };
}
