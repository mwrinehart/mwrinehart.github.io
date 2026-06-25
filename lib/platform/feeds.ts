// Shared RSS/feed scanning + classification engine.
//
// Horizon Scanner ("Compliance Radar") and CBM's "Threat Pulse" are essentially
// the same pipeline: fetch RSS feeds → match keywords → assign a severity →
// dedupe by link → surface findings → optionally alert. That engine lives here
// once; the Compliance and Behavior modules supply their own feed lists and
// keyword rules and consume the results.

import Parser from "rss-parser";

export type Severity = "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: string | null;
  feedName: string;
}

export interface KeywordRule {
  term: string;
  category?: string;
  /** Minimum severity to assign when this term matches. */
  severityFloor?: Severity;
}

export interface Classification {
  severity: Severity;
  categories: string[];
  matched: string[];
}

const parser = new Parser({ timeout: 15000 });

export async function scanFeed(url: string, feedName: string): Promise<FeedItem[]> {
  const feed = await parser.parseURL(url);
  return (feed.items ?? []).map((it) => ({
    title: it.title?.trim() || "(untitled)",
    link: it.link?.trim() || "",
    summary: (it.contentSnippet || it.content || "").trim().slice(0, 2000),
    publishedAt: it.isoDate || it.pubDate || null,
    feedName,
  }));
}

// Classify an item against a keyword ruleset. Severity is the highest floor among
// all matched terms (default medium when something matched, low otherwise).
export function classifyItem(item: FeedItem, rules: KeywordRule[]): Classification {
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  const matched: string[] = [];
  const categories = new Set<string>();
  let severity: Severity = "low";

  for (const rule of rules) {
    if (!rule.term) continue;
    if (haystack.includes(rule.term.toLowerCase())) {
      matched.push(rule.term);
      if (rule.category) categories.add(rule.category);
      // Category-only rules (no floor) tag without escalating; severity rules
      // raise the floor. Highest matched floor wins.
      const floor = rule.severityFloor ?? "low";
      if (SEVERITY_RANK[floor] > SEVERITY_RANK[severity]) severity = floor;
    }
  }

  return { severity, categories: [...categories], matched };
}

export function severityAtLeast(value: Severity, min: Severity): boolean {
  return SEVERITY_RANK[value] >= SEVERITY_RANK[min];
}

// Lightweight SSRF guard for user-supplied feed URLs, shared by every module that
// lets tenants add feeds (Behavior Pulse, Compliance). Rejects non-http(s) and
// private/loopback/link-local hosts. (Full DNS-rebind protection at resolve time
// is a follow-up.)
export function assertSafeFeedUrl(raw: string): URL {
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
