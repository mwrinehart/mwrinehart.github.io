// External ingestion connectors for the Compliance module (rebuilt from
// Horizon's regulatory.js / breach_portal.js / oig_workplan.js). Each connector
// fetches from a structured source and returns items in the shared FeedItem
// shape, so they flow through the SAME classify → score → dedupe → store →
// auto-route pipeline as RSS feeds.
//
// - federal-register: real public JSON API (works out of the box).
// - hhs-breach / oig-workplan: no stable public JSON API (Horizon scraped HTML).
//   These ingest from a tenant-configured JSON endpoint (`config.url`) and are
//   skipped until one is set — surfaced clearly in the UI.

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { assertSafeFeedUrl, type FeedItem } from "@/lib/platform/feeds";
import { complianceConnectors } from "./schema";

export type ConnectorType = "federal-register" | "hhs-breach" | "oig-workplan";

export interface ConnectorConfig {
  terms?: string[];
  agencies?: string[];
  url?: string;
}

export interface ConnectorDef {
  type: ConnectorType;
  label: string;
  description: string;
  /** Whether this connector works without per-org config. */
  worksOutOfBox: boolean;
  defaultConfig: ConnectorConfig;
}

export const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    type: "federal-register",
    label: "Federal Register",
    description: "Agency rulemaking & notices from the Federal Register public API.",
    worksOutOfBox: true,
    defaultConfig: { terms: ["cybersecurity", "HIPAA", "data breach", "privacy"] },
  },
  {
    type: "hhs-breach",
    label: "HHS breach portal",
    description: "HHS OCR reported breaches. Point at a JSON export endpoint (no stable public API).",
    worksOutOfBox: false,
    defaultConfig: {},
  },
  {
    type: "oig-workplan",
    label: "OIG work plan",
    description: "HHS OIG work-plan items. Point at a JSON endpoint (no stable public API).",
    worksOutOfBox: false,
    defaultConfig: {},
  },
];

function parseConfig(raw: string | null): ConnectorConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ConnectorConfig;
  } catch {
    return {};
  }
}

// ─── fetchers ─────────────────────────────────────────────────────────────────

async function fetchFederalRegister(config: ConnectorConfig): Promise<FeedItem[]> {
  const terms = config.terms?.length ? config.terms : ["cybersecurity", "HIPAA", "data breach", "privacy"];
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("order", "newest");
  url.searchParams.set("conditions[term]", terms.join(" "));
  for (const a of config.agencies ?? []) url.searchParams.append("conditions[agencies][]", a);

  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Federal Register ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; abstract?: string; html_url?: string; publication_date?: string; agencies?: Array<{ name?: string }> }> };
  return (data.results ?? []).map((d) => ({
    title: d.title?.trim() || "(untitled)",
    link: d.html_url?.trim() || "",
    summary: (d.abstract || "").trim().slice(0, 2000) + (d.agencies?.length ? ` [${d.agencies.map((a) => a.name).filter(Boolean).join(", ")}]` : ""),
    publishedAt: d.publication_date || null,
    feedName: "Federal Register",
  }));
}

// Generic JSON-endpoint fetcher for connectors without a stable public API.
async function fetchJsonEndpoint(config: ConnectorConfig, sourceName: string): Promise<FeedItem[]> {
  if (!config.url) throw new Error("No source URL configured");
  await assertSafeFeedUrl(config.url); // SSRF guard — same as tenant-added feeds
  const res = await fetch(config.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${sourceName} ${res.status}`);
  const json = await res.json();
  const rows: Record<string, unknown>[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { results?: unknown[]; items?: unknown[]; data?: unknown[] })?.results)
      ? (json as { results: Record<string, unknown>[] }).results
      : Array.isArray((json as { items?: unknown[] })?.items)
        ? (json as { items: Record<string, unknown>[] }).items
        : Array.isArray((json as { data?: unknown[] })?.data)
          ? (json as { data: Record<string, unknown>[] }).data
          : [];
  const pick = (r: Record<string, unknown>, keys: string[]): string => {
    for (const k of keys) if (typeof r[k] === "string" && (r[k] as string).trim()) return (r[k] as string).trim();
    return "";
  };
  return rows.map((r) => ({
    title: pick(r, ["title", "name", "subject", "entity"]) || "(untitled)",
    link: pick(r, ["link", "url", "html_url", "href"]),
    summary: pick(r, ["summary", "description", "abstract", "details"]).slice(0, 2000),
    publishedAt: pick(r, ["publishedAt", "date", "reportDate", "submittedDate", "added"]) || null,
    feedName: sourceName,
  }));
}

export async function fetchConnectorItems(type: ConnectorType, config: ConnectorConfig): Promise<FeedItem[]> {
  if (type === "federal-register") return fetchFederalRegister(config);
  if (type === "hhs-breach") return fetchJsonEndpoint(config, "HHS breach portal");
  return fetchJsonEndpoint(config, "OIG work plan");
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface ConnectorView {
  type: ConnectorType;
  label: string;
  description: string;
  worksOutOfBox: boolean;
  enabled: boolean;
  config: ConnectorConfig;
  lastScannedAt: number | null;
  lastError: string | null;
}

// Always returns all three connectors (defs merged with any stored state).
export async function listConnectors(orgId: string): Promise<ConnectorView[]> {
  const rows = await db.select().from(complianceConnectors).where(eq(complianceConnectors.orgId, orgId));
  return CONNECTOR_DEFS.map((def) => {
    const row = rows.find((r) => r.type === def.type);
    return {
      type: def.type,
      label: def.label,
      description: def.description,
      worksOutOfBox: def.worksOutOfBox,
      enabled: row?.enabled ?? false,
      config: row ? parseConfig(row.config) : def.defaultConfig,
      lastScannedAt: row?.lastScannedAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}

export async function listEnabledConnectors(orgId: string): Promise<Array<{ type: ConnectorType; config: ConnectorConfig }>> {
  const rows = await db
    .select()
    .from(complianceConnectors)
    .where(and(eq(complianceConnectors.orgId, orgId), eq(complianceConnectors.enabled, true)));
  return rows.map((r) => ({ type: r.type as ConnectorType, config: parseConfig(r.config) }));
}

async function upsertConnector(orgId: string, type: ConnectorType, patch: Partial<{ enabled: boolean; config: string; lastScannedAt: number; lastError: string | null }>): Promise<void> {
  const now = Date.now();
  const existing = await db
    .select({ id: complianceConnectors.id })
    .from(complianceConnectors)
    .where(and(eq(complianceConnectors.orgId, orgId), eq(complianceConnectors.type, type)));
  if (existing[0]) {
    await db.update(complianceConnectors).set({ ...patch, updatedAt: now }).where(eq(complianceConnectors.id, existing[0].id));
  } else {
    await db.insert(complianceConnectors).values({
      id: randomUUID(),
      orgId,
      type,
      enabled: patch.enabled ?? false,
      config: patch.config ?? null,
      lastScannedAt: patch.lastScannedAt ?? null,
      lastError: patch.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function setConnectorEnabled(orgId: string, type: ConnectorType, enabled: boolean): Promise<void> {
  return upsertConnector(orgId, type, { enabled });
}

export function setConnectorConfig(orgId: string, type: ConnectorType, config: ConnectorConfig): Promise<void> {
  return upsertConnector(orgId, type, { config: JSON.stringify(config) });
}

export function markConnectorScanned(orgId: string, type: ConnectorType, error: string | null): Promise<void> {
  return upsertConnector(orgId, type, { lastScannedAt: Date.now(), lastError: error });
}

const LABELS: Record<ConnectorType, string> = {
  "federal-register": "Federal Register",
  "hhs-breach": "HHS breach portal",
  "oig-workplan": "OIG work plan",
};
export function connectorLabel(type: ConnectorType): string {
  return LABELS[type];
}
