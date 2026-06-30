// Data-source sync (ported from CBM dataSources.js).
//
// Two providers: `jericho-app` (Bearer token → app.jerichosecurity.com) and
// `litmos` (apikey header → api.litmos.com). Each sync ingests roster + events
// into the import ledgers, deduped by (org_id, provider, external_id), then
// recomputes risk. Base URLs are origin-allowlisted to block SSRF.

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { getOrgSecret } from "@/lib/platform/secrets";
import {
  behaviorGroups,
  behaviorPeople,
  dataSourceConfigs,
  dataSyncRuns,
  importedCampaignEvents,
  importedLmsRecords,
  triageEmailEvents,
} from "./schema";
import { recomputeRiskForOrg } from "./scoring";

export type Provider = "jericho-app" | "litmos";
export const PROVIDERS: Provider[] = ["jericho-app", "litmos"];

const JERICHO_DEFAULT_BASE = "https://app.jerichosecurity.com";
const JERICHO_PATHS = {
  users: "/api/v1/users",
  groups: "/api/v1/groups",
  campaigns: "/api/v1/campaigns",
  triage: "/api/v1/triage-center/events",
  emailSecurity: "/api/v1/email-security/events",
};
const LITMOS_ALLOWED = ["https://api.litmos.com", "https://api-eu.litmos.com"];

// Secret keys (per-org encrypted store).
const SECRET = {
  jerichoApiKey: "jerichoAppApiKey",
  litmosApiKey: "litmosApiKey",
  litmosBaseUrl: "litmosBaseUrl",
  litmosSource: "litmosSource",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function scopedExternalId(orgId: string, provider: string, raw: unknown): string {
  return `${orgId}:${provider}:${String(raw ?? randomUUID())}`;
}

function pickStr(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickDate(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" || typeof v === "number") {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

// Pull the array of records out of whatever envelope the API used.
function extractRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "items", "results", "rows", "records", "users", "groups", "campaigns", "events"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

// SSRF guard: only allow the known provider origins over HTTPS.
function assertAllowedBaseUrl(provider: Provider, baseUrl: string): void {
  let origin: string;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:") throw new Error("https required");
    origin = u.origin;
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  const allowed = provider === "jericho-app" ? [JERICHO_DEFAULT_BASE] : LITMOS_ALLOWED;
  if (!allowed.includes(origin)) {
    throw new Error(`Base URL ${origin} is not allowlisted for ${provider}`);
  }
}

async function fetchRows(url: string, headers: Record<string, string>): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return extractRows(await res.json());
}

// ─── upserts ────────────────────────────────────────────────────────────────

async function upsertPerson(orgId: string, row: Record<string, unknown>): Promise<void> {
  const email = pickStr(row, ["email", "userEmail", "emailAddress", "mail"]);
  if (!email) return;
  const name = pickStr(row, ["name", "fullName", "displayName", "username"]);
  const department = pickStr(row, ["department", "dept", "division"]);
  const groupName = pickStr(row, ["group", "groupName", "team", "teamName"]);

  const emailLc = email.toLowerCase();
  // Atomic insert: if (org_id, email) already exists, ON CONFLICT DO NOTHING
  // returns no row. This closes the select-then-insert race where two concurrent
  // syncs both miss the existing row and both insert a duplicate person.
  const inserted = await db
    .insert(behaviorPeople)
    .values({
      id: randomUUID(),
      orgId,
      email: emailLc,
      name,
      department,
      groupName,
      riskScore: 0,
      lastActiveAt: pickDate(row, ["lastActive", "lastActiveAt", "lastLogin"]),
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: [behaviorPeople.orgId, behaviorPeople.email] })
    .returning({ id: behaviorPeople.id });

  if (inserted.length) return; // freshly created

  // Already existed (or a concurrent insert won the race): patch only the fields
  // the source actually provided (avoids an empty .set()).
  const patch: Record<string, string> = {};
  if (name) patch.name = name;
  if (department) patch.department = department;
  if (groupName) patch.groupName = groupName;
  if (Object.keys(patch).length) {
    await db.update(behaviorPeople).set(patch).where(and(eq(behaviorPeople.orgId, orgId), eq(behaviorPeople.email, emailLc)));
  }
}

async function upsertGroup(orgId: string, provider: string, row: Record<string, unknown>): Promise<void> {
  const name = pickStr(row, ["name", "title", "groupName", "teamName"]);
  if (!name) return;
  const externalId = scopedExternalId(orgId, provider, pickStr(row, ["id", "externalId", "groupId"]));
  const existing = await db
    .select({ id: behaviorGroups.id })
    .from(behaviorGroups)
    .where(and(eq(behaviorGroups.orgId, orgId), eq(behaviorGroups.externalId, externalId)));
  if (existing[0]) return;
  await db.insert(behaviorGroups).values({
    id: randomUUID(),
    orgId,
    name,
    description: pickStr(row, ["description", "desc"]),
    externalId,
    createdAt: Date.now(),
  });
}

async function upsertCampaign(orgId: string, provider: string, row: Record<string, unknown>): Promise<void> {
  const rawId = pickStr(row, ["id", "eventId", "externalId"]) ?? randomUUID();
  await db
    .insert(importedCampaignEvents)
    .values({
      id: randomUUID(),
      orgId,
      provider,
      externalId: scopedExternalId(orgId, provider, rawId),
      campaignType: pickStr(row, ["type", "campaignType", "subtype"]),
      name: pickStr(row, ["name", "campaignName", "title"]),
      status: pickStr(row, ["status"]),
      userEmail: pickStr(row, ["userEmail", "email", "recipient"])?.toLowerCase() ?? null,
      userId: pickStr(row, ["userId", "user_id"]),
      groupName: pickStr(row, ["group", "groupName", "team"]),
      eventType: pickStr(row, ["eventType", "event", "action"]),
      eventAt: pickDate(row, ["eventAt", "timestamp", "date", "occurredAt"]),
      rawJson: JSON.stringify(row),
      importedAt: Date.now(),
    })
    .onConflictDoNothing();
}

async function upsertTriage(orgId: string, provider: string, row: Record<string, unknown>): Promise<void> {
  const rawId = pickStr(row, ["id", "eventId", "externalId"]) ?? randomUUID();
  await db
    .insert(triageEmailEvents)
    .values({
      id: randomUUID(),
      orgId,
      provider,
      externalId: scopedExternalId(orgId, provider, rawId),
      subject: pickStr(row, ["subject"]),
      sender: pickStr(row, ["sender", "from"]),
      recipientEmail: pickStr(row, ["recipientEmail", "recipient", "userEmail", "email"])?.toLowerCase() ?? null,
      verdict: pickStr(row, ["verdict", "disposition"]),
      severity: pickStr(row, ["severity", "risk"]),
      status: pickStr(row, ["status"]),
      reportedAt: pickDate(row, ["reportedAt", "timestamp", "date"]),
      rawJson: JSON.stringify(row),
      importedAt: Date.now(),
    })
    .onConflictDoNothing();
}

async function upsertLms(orgId: string, provider: string, recordType: string, row: Record<string, unknown>): Promise<void> {
  const rawId = pickStr(row, ["Id", "id", "externalId"]) ?? randomUUID();
  await db
    .insert(importedLmsRecords)
    .values({
      id: randomUUID(),
      orgId,
      provider,
      recordType,
      externalId: scopedExternalId(orgId, `${provider}:${recordType}`, rawId),
      userEmail: pickStr(row, ["Email", "email", "userEmail"])?.toLowerCase() ?? null,
      title: pickStr(row, ["Name", "name", "title", "CourseName"]),
      status: pickStr(row, ["Status", "status"]),
      score: pickNum(row, ["Score", "score", "PercentageComplete"]),
      completedAt: pickDate(row, ["CompletedDate", "completedAt", "completed_at"]),
      rawJson: JSON.stringify(row),
      importedAt: Date.now(),
    })
    .onConflictDoNothing();
}

// ─── per-provider sync ──────────────────────────────────────────────────────

interface SyncSummary {
  counts: Record<string, number>;
  errors: string[];
}

async function syncJerichoApp(orgId: string, baseUrl: string): Promise<SyncSummary> {
  assertAllowedBaseUrl("jericho-app", baseUrl);
  const apiKey = await getOrgSecret(orgId, SECRET.jerichoApiKey);
  if (!apiKey) throw new Error("Jericho app API key not configured (set it on the Sources page).");
  const headers = { authorization: `Bearer ${apiKey}`, accept: "application/json" };
  const counts: Record<string, number> = { users: 0, groups: 0, campaigns: 0, triage: 0 };
  const errors: string[] = [];

  const step = async (label: string, path: string, fn: (r: Record<string, unknown>) => Promise<void>) => {
    try {
      const rows = await fetchRows(baseUrl + path, headers);
      for (const r of rows) await fn(r);
      counts[label] = (counts[label] ?? 0) + rows.length;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await step("users", JERICHO_PATHS.users, (r) => upsertPerson(orgId, r));
  await step("groups", JERICHO_PATHS.groups, (r) => upsertGroup(orgId, "jericho-app", r));
  await step("campaigns", JERICHO_PATHS.campaigns, (r) => upsertCampaign(orgId, "jericho-app", r));
  await step("triage", JERICHO_PATHS.triage, (r) => upsertTriage(orgId, "jericho-app", r));
  await step("triage", JERICHO_PATHS.emailSecurity, (r) => upsertTriage(orgId, "jericho-app", r));

  return { counts, errors };
}

async function syncLitmos(orgId: string): Promise<SyncSummary> {
  const baseUrl = (await getOrgSecret(orgId, SECRET.litmosBaseUrl)) || LITMOS_ALLOWED[0];
  assertAllowedBaseUrl("litmos", baseUrl);
  const apiKey = await getOrgSecret(orgId, SECRET.litmosApiKey);
  if (!apiKey) throw new Error("Litmos API key not configured (set it on the Sources page).");
  const source = (await getOrgSecret(orgId, SECRET.litmosSource)) || "jericho-platform";
  const headers = { apikey: apiKey, accept: "application/json" };
  const counts: Record<string, number> = { users: 0, teams: 0, courses: 0, learningPaths: 0 };
  const errors: string[] = [];

  // Litmos pages at 200 rows; walk start until a short page (cap pages to bound a
  // runaway). Without this only the first 200 rows of large tenants were imported.
  const PAGE = 200;
  const MAX_PAGES = 50;
  const fetchAllPages = async (path: string): Promise<Record<string, unknown>[]> => {
    const all: Record<string, unknown>[] = [];
    for (let start = 0; start < PAGE * MAX_PAGES; start += PAGE) {
      const q = `?source=${encodeURIComponent(source)}&limit=${PAGE}&start=${start}`;
      const rows = await fetchRows(baseUrl + path + q, headers);
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    return all;
  };

  const step = async (label: string, path: string, fn: (r: Record<string, unknown>) => Promise<void>) => {
    try {
      const rows = await fetchAllPages(path);
      for (const r of rows) await fn(r);
      counts[label] = rows.length;
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await step("users", "/users", async (r) => {
    await upsertPerson(orgId, r);
    await upsertLms(orgId, "litmos", "user", r);
  });
  await step("teams", "/teams", async (r) => {
    await upsertGroup(orgId, "litmos", r);
    await upsertLms(orgId, "litmos", "team", r);
  });
  await step("courses", "/courses", (r) => upsertLms(orgId, "litmos", "course", r));
  await step("learningPaths", "/learningpaths", (r) => upsertLms(orgId, "litmos", "learning_path", r));

  return { counts, errors };
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function listConfigs(orgId: string) {
  return db.select().from(dataSourceConfigs).where(eq(dataSourceConfigs.orgId, orgId));
}

export async function listRecentRuns(orgId: string, limit = 20) {
  const rows = await db.select().from(dataSyncRuns).where(eq(dataSyncRuns.orgId, orgId));
  return rows.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function upsertConfig(
  orgId: string,
  provider: Provider,
  input: { name?: string; baseUrl?: string },
): Promise<void> {
  const baseUrl = input.baseUrl?.trim() || (provider === "jericho-app" ? JERICHO_DEFAULT_BASE : LITMOS_ALLOWED[0]);
  assertAllowedBaseUrl(provider, baseUrl);
  const now = Date.now();
  const existing = await db
    .select({ id: dataSourceConfigs.id })
    .from(dataSourceConfigs)
    .where(and(eq(dataSourceConfigs.orgId, orgId), eq(dataSourceConfigs.provider, provider)));
  if (existing[0]) {
    await db
      .update(dataSourceConfigs)
      .set({ name: input.name ?? provider, baseUrl, updatedAt: now })
      .where(eq(dataSourceConfigs.id, existing[0].id));
  } else {
    await db.insert(dataSourceConfigs).values({
      id: randomUUID(),
      orgId,
      provider,
      name: input.name ?? provider,
      baseUrl,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Run a sync for one provider: open a run row, ingest, recompute risk, and record
// status on both the run and the config.
export async function runSync(orgId: string, provider: Provider): Promise<DataSyncResult> {
  const runId = randomUUID();
  const started = Date.now();
  await db.insert(dataSyncRuns).values({ id: runId, orgId, provider, status: "running", startedAt: started });

  let status: "success" | "partial" | "failed";
  let summary: SyncSummary | null = null;
  let error: string | null = null;
  try {
    const cfg = (await listConfigs(orgId)).find((c) => c.provider === provider);
    const baseUrl = cfg?.baseUrl || (provider === "jericho-app" ? JERICHO_DEFAULT_BASE : LITMOS_ALLOWED[0]);
    summary = provider === "jericho-app" ? await syncJerichoApp(orgId, baseUrl) : await syncLitmos(orgId);
    status = summary.errors.length ? "partial" : "success";
    await recomputeRiskForOrg(orgId);
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  }

  const finished = Date.now();
  await db
    .update(dataSyncRuns)
    .set({ status, finishedAt: finished, summary: summary ? JSON.stringify(summary) : null, error })
    .where(eq(dataSyncRuns.id, runId));
  await db
    .update(dataSourceConfigs)
    .set({ lastSyncAt: finished, lastStatus: status, lastError: error })
    .where(and(eq(dataSourceConfigs.orgId, orgId), eq(dataSourceConfigs.provider, provider)));

  return { status, summary, error };
}

export interface DataSyncResult {
  status: "success" | "partial" | "failed";
  summary: SyncSummary | null;
  error: string | null;
}
