// Shared RSS/feed scanning + classification engine.
//
// Horizon Scanner ("Compliance Radar") and CBM's "Threat Pulse" are essentially
// the same pipeline: fetch RSS feeds → match keywords → assign a severity →
// dedupe by link → surface findings → optionally alert. That engine lives here
// once; the Compliance and Behavior modules supply their own feed lists and
// keyword rules and consume the results.

import { lookup } from "dns/promises";
import { isIP } from "net";
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

// Hard cap on items taken from a single feed/connector per scan, so a feed (or a
// hostile/compromised endpoint) returning a huge list can't drive unbounded
// inserts and alert dispatch in one scan tick.
export const MAX_FEED_ITEMS = 200;

export async function scanFeed(url: string, feedName: string): Promise<FeedItem[]> {
  // Re-validate at fetch time, not just at add time: a stored feed's host may now
  // resolve to a private/metadata address (DNS change or rebinding).
  await assertSafeFeedUrl(url);
  const feed = await parser.parseURL(url);
  return (feed.items ?? []).slice(0, MAX_FEED_ITEMS).map((it) => ({
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

// Numeric rank for ordering/high-water-mark comparisons. An unknown/null value
// (e.g. a finding that has never been routed) ranks below "low" so any real
// severity counts as an escalation past it.
export function severityRank(value: Severity | null | undefined): number {
  return value && value in SEVERITY_RANK ? SEVERITY_RANK[value] : -1;
}

// SSRF guard for user-supplied feed/connector URLs, shared by every module that
// fetches a tenant-provided URL server-side (Behavior Pulse, Compliance feeds and
// connectors). It resolves the host via DNS and rejects if ANY resolved address
// is private/loopback/link-local/reserved — which also defeats encoded-IP tricks
// (decimal/octal/hex) since the resolver normalizes them. Residual risk: DNS
// rebinding between this check and the fetch; full protection requires pinning the
// resolved IP at connect time (follow-up).

function ipv4Blocked(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true; // loopback, unspecified
  if (x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb")) return true; // link-local fe80::/10
  if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique-local fc00::/7
  if (x.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix — can wrap private IPv4
  if (x.startsWith("2002:")) return true; // 6to4 — embeds an IPv4 address
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): if a trailing
  // dotted quad is present, vet it through the IPv4 rules so e.g.
  // ::ffff:169.254.169.254 (cloud metadata) and ::127.0.0.1 are blocked.
  const dotted = x.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && (x.startsWith("::ffff:") || x.startsWith("::"))) return ipv4Blocked(dotted[1]);
  return false;
}

function addressBlocked(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ipv4Blocked(ip);
  if (fam === 6) return ipv6Blocked(ip);
  return true; // not a recognizable IP → block
}

export async function assertSafeFeedUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid feed URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Feed URL must be http(s)");
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error("Feed URL host could not be resolved");
  }
  if (addrs.length === 0 || addrs.some((a) => addressBlocked(a.address))) {
    throw new Error("Feed URL host is not allowed");
  }
  return u;
}
