// Learning Center configuration. The dashboard talks to Litmos with ONE
// account-level API key (env-configured, never per-team-admin) and derives all
// per-admin authorization itself, so key handling stays server-side and simple.

import { bool, isDev, list, str } from "@/lib/platform/env";

export interface LitmosCreds {
  base: string;
  apiKey: string;
  source: string;
}

// Litmos regional API hosts (SSRF allowlist — union of the hosts both existing
// Jericho integrations accept plus SAP's documented regional endpoints).
const ALLOWED_HOSTS = new Set([
  "api.litmos.com",
  "api.litmoseu.com",
  "api-eu.litmos.com",
  "api.litmos.com.au",
  "api.litmos.co.uk",
  "api.litmos.eu",
]);

export function normalizeBaseUrl(raw: string | null): string {
  const fallback = "https://api.litmos.com/v1.svc";
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fallback;
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return fallback;
  let base = `https://${url.hostname}${url.pathname}`.replace(/\/+$/, "");
  if (!base.endsWith("/v1.svc")) base += "/v1.svc";
  return base;
}

export function litmosCreds(): LitmosCreds | null {
  const apiKey = str("LITMOS_API_KEY");
  if (!apiKey) return null;
  return {
    base: normalizeBaseUrl(str("LITMOS_BASE_URL")),
    apiKey,
    source: str("LITMOS_SOURCE") || "jericho-learning-center",
  };
}

// Demo mode: forced via LEARNING_CENTER_DEMO, or automatic when no API key is
// configured — the whole dashboard then runs against a seeded in-memory tenant.
export function isDemoMode(): boolean {
  if (bool("LEARNING_CENTER_DEMO")) return true;
  return !litmosCreds();
}

// Dashboard owners: full account-wide view plus the settings page. Everyone
// else authenticates as whatever Litmos says they are (team admin / learner).
export function ownerEmails(): string[] {
  return list("LEARNING_CENTER_OWNER_EMAILS");
}

// Brands whose notification templates are managed by Jericho centrally. A team
// on one of these brands gets a read-only notifications page; custom-branded
// teams manage their own templates here.
export function defaultBrandNames(): string[] {
  const configured = list("LEARNING_CENTER_DEFAULT_BRANDS");
  return configured.length ? configured : ["jericho security", "default", ""];
}

export function isDefaultBrand(brand: string | null | undefined): boolean {
  return defaultBrandNames().includes((brand ?? "").trim().toLowerCase());
}

// Base URL of the learner-facing Litmos tenant, used to build course deep links
// when a LoginKey is unavailable.
export function learnerPortalUrl(): string {
  return str("LITMOS_LEARNER_URL") || "https://jerichosecurity.litmos.com";
}

// Show one-time login codes on screen instead of emailing them — only in local
// development or demo mode (never a production convenience for a live tenant).
export function showLoginCodeInline(): boolean {
  return isDev || isDemoMode();
}
