// Shared Litmos API client. Behavior (training sync/assignments), LMS (the full
// Litmos admin surface), and Studio (one-click course publishing) all talk to
// Litmos, so the transport lives here per the "two modules need it → platform"
// rule. Credentials are per-org: `litmosApiKey` / `litmosBaseUrl` / `litmosSource`
// in the encrypted secret store. Every call sends the `apikey` header plus the
// `source` query param Litmos uses for audit attribution.

import { getOrgSecret } from "./secrets";

export interface LitmosCreds {
  base: string;
  apiKey: string;
  source: string;
}

export const LITMOS_DEFAULT_BASE = "https://api.litmos.com/v1.svc";

// Litmos serves regional hosts (api.litmos.com, api-eu.litmos.com, …) that all
// expose the API under /v1.svc — append it when a stored base URL omits it.
export function normalizeLitmosBase(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return LITMOS_DEFAULT_BASE;
  if (trimmed.includes("/v1.svc")) return trimmed.replace(/\/+$/, "");
  return trimmed.replace(/\/+$/, "") + "/v1.svc";
}

export async function getLitmosCreds(orgId: string): Promise<LitmosCreds | null> {
  const apiKey = await getOrgSecret(orgId, "litmosApiKey");
  if (!apiKey) return null;
  const base = normalizeLitmosBase(await getOrgSecret(orgId, "litmosBaseUrl"));
  const source = (await getOrgSecret(orgId, "litmosSource")) || "jericho-platform";
  return { base, apiKey, source };
}

const LITMOS_TIMEOUT_MS = 20_000;

export async function litmosFetch(creds: LitmosCreds, path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${creds.base}${path}${sep}source=${encodeURIComponent(creds.source)}`;
  return fetch(url, {
    ...init,
    headers: {
      apikey: creds.apiKey,
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(LITMOS_TIMEOUT_MS),
  });
}

// Envelope-safe: Litmos usually returns a bare array, but tolerate wrapped
// responses so an envelope doesn't throw on .find/.length.
export function extractLitmosArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    for (const key of ["Items", "items", "results", "data", "Users", "Teams", "Courses"]) {
      const v = (json as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

// Page through a Litmos collection endpoint (limit/start paging) until a short
// page or the page cap. `path` may already carry query params.
//
// `truncated` means the cap was hit with a still-full final page — the caller
// got a PREFIX of the collection, not all of it. Sync uses this to skip its
// "missing from Litmos" deactivation diff, which would otherwise deactivate
// every record past the cap. A 200 response whose body is a non-empty object
// with no recognized array key throws instead of silently reading as an empty
// collection (an unrecognized envelope must degrade the step, not empty the
// mirror).
export async function litmosGetAllEx(creds: LitmosCreds, path: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const all: Record<string, unknown>[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const sep = path.includes("?") ? "&" : "?";
    const res = await litmosFetch(creds, `${path}${sep}limit=${PAGE_SIZE}&start=${start}`);
    if (!res.ok) throw new Error(`litmos GET ${path} ${res.status}`);
    const json = await res.json();
    const rows = extractLitmosArray(json);
    if (!rows.length && json && typeof json === "object" && !Array.isArray(json) && Object.keys(json as object).length) {
      throw new Error(`litmos GET ${path}: unrecognized response shape (keys: ${Object.keys(json as object).slice(0, 5).join(",")})`);
    }
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { rows: all, truncated };
}

export async function litmosGetAll(creds: LitmosCreds, path: string): Promise<Record<string, unknown>[]> {
  return (await litmosGetAllEx(creds, path)).rows;
}

async function litmosBody(res: Response): Promise<string> {
  return (await res.text()).slice(0, 1000);
}

// ─── users ────────────────────────────────────────────────────────────────────

export interface LitmosUserRecord {
  Id: string;
  UserName?: string;
  FirstName?: string;
  LastName?: string;
  FullName?: string;
  Email?: string;
  Active?: boolean;
  CreatedDate?: string;
  LastLogin?: string;
  AccessLevel?: string;
}

export function listLitmosUsers(creds: LitmosCreds): Promise<Record<string, unknown>[]> {
  return litmosGetAll(creds, "/users/details");
}

export async function findLitmosUserByEmail(creds: LitmosCreds, email: string): Promise<LitmosUserRecord | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  // /users?search= matches username/email/name server-side; verify the email
  // client-side because search is fuzzy.
  const res = await litmosFetch(creds, `/users?search=${encodeURIComponent(target)}&limit=${PAGE_SIZE}`);
  if (!res.ok) throw new Error(`litmos user search ${res.status}`);
  const rows = extractLitmosArray(await res.json());
  const match = rows.find((u) => String(u.Email ?? "").toLowerCase() === target || String(u.UserName ?? "").toLowerCase() === target);
  if (match?.Id) return match as unknown as LitmosUserRecord;
  // Fall back to a full page-through for tenants where search is disabled.
  for (let start = 0; start < PAGE_SIZE * MAX_PAGES; start += PAGE_SIZE) {
    const page = await litmosFetch(creds, `/users?limit=${PAGE_SIZE}&start=${start}`);
    if (!page.ok) throw new Error(`litmos users ${page.status}`);
    const all = extractLitmosArray(await page.json());
    const hit = all.find((u) => String(u.Email ?? "").toLowerCase() === target || String(u.UserName ?? "").toLowerCase() === target);
    if (hit?.Id) return hit as unknown as LitmosUserRecord;
    if (all.length < PAGE_SIZE) break;
  }
  return null;
}

export interface CreateLitmosUserInput {
  email: string;
  firstName: string;
  lastName: string;
  /** Suppress Litmos's own welcome/notification emails (we send our own). */
  disableMessages?: boolean;
}

export async function createLitmosUser(creds: LitmosCreds, input: CreateLitmosUserInput): Promise<LitmosUserRecord> {
  const res = await litmosFetch(creds, "/users", {
    method: "POST",
    body: JSON.stringify({
      Id: "",
      UserName: input.email,
      FirstName: input.firstName,
      LastName: input.lastName,
      Email: input.email,
      DisableMessages: input.disableMessages ?? true,
      Active: true,
      SkipFirstLogin: false,
    }),
  });
  if (!res.ok) throw new Error(`litmos create user ${res.status}: ${await litmosBody(res)}`);
  const json = (await res.json().catch(() => null)) as LitmosUserRecord | LitmosUserRecord[] | null;
  const created = Array.isArray(json) ? json[0] : json;
  if (!created?.Id) throw new Error("litmos create user: no Id in response");
  return created;
}

// Litmos PUT /users/{id} replaces the record — send the full object back with
// the fields you want changed.
export async function updateLitmosUser(creds: LitmosCreds, id: string, record: Record<string, unknown>): Promise<void> {
  const res = await litmosFetch(creds, `/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(record) });
  if (!res.ok) throw new Error(`litmos update user ${res.status}: ${await litmosBody(res)}`);
}

export async function getLitmosUser(creds: LitmosCreds, id: string): Promise<Record<string, unknown> | null> {
  const res = await litmosFetch(creds, `/users/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`litmos get user ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── courses ──────────────────────────────────────────────────────────────────

export interface LitmosCourseRecord {
  Id: string;
  Name?: string;
  Description?: string;
  Code?: string;
  Active?: boolean;
  CourseCreatedDate?: string;
  CreatedDate?: string;
  OriginalId?: number;
}

export function listLitmosCourses(creds: LitmosCreds): Promise<Record<string, unknown>[]> {
  return litmosGetAll(creds, "/courses");
}

export interface CreateLitmosCourseInput {
  name: string;
  description?: string;
  code?: string;
  active?: boolean;
}

// Course creation is not enabled on every Litmos plan/API tier — callers must
// surface the error body so admins can see Litmos's actual response.
export async function createLitmosCourse(creds: LitmosCreds, input: CreateLitmosCourseInput): Promise<LitmosCourseRecord> {
  const res = await litmosFetch(creds, "/courses", {
    method: "POST",
    body: JSON.stringify({
      Id: "",
      Name: input.name,
      Description: input.description ?? "",
      Code: input.code ?? "",
      Active: input.active ?? true,
      ForSale: false,
    }),
  });
  if (!res.ok) throw new Error(`litmos create course ${res.status}: ${await litmosBody(res)}`);
  const json = (await res.json().catch(() => null)) as LitmosCourseRecord | LitmosCourseRecord[] | null;
  const created = Array.isArray(json) ? json[0] : json;
  if (!created?.Id) throw new Error("litmos create course: no Id in response");
  return created;
}

export async function getLitmosCourse(creds: LitmosCreds, id: string): Promise<Record<string, unknown> | null> {
  const res = await litmosFetch(creds, `/courses/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`litmos get course ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// Litmos PUT replaces the whole course record, so merge the patch into the
// fetched record — a from-scratch body would wipe fields we don't model
// (ForSale, pricing, e-commerce copy). Minimal record only as a last resort.
export async function updateLitmosCourse(creds: LitmosCreds, id: string, patch: CreateLitmosCourseInput): Promise<void> {
  let record: Record<string, unknown>;
  try {
    record = (await getLitmosCourse(creds, id)) ?? { Id: id, ForSale: false };
  } catch {
    record = { Id: id, ForSale: false };
  }
  const res = await litmosFetch(creds, `/courses/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...record,
      Id: id,
      Name: patch.name,
      Description: patch.description ?? "",
      Code: patch.code ?? "",
      Active: patch.active ?? true,
    }),
  });
  if (!res.ok) throw new Error(`litmos update course ${res.status}: ${await litmosBody(res)}`);
}

// ─── enrollment + results ────────────────────────────────────────────────────

export async function assignUserCourses(creds: LitmosCreds, litmosUserId: string, courseIds: string[]): Promise<string> {
  const res = await litmosFetch(creds, `/users/${encodeURIComponent(litmosUserId)}/courses`, {
    method: "POST",
    body: JSON.stringify(courseIds.map((Id) => ({ Id }))),
  });
  const body = await litmosBody(res);
  if (!res.ok) throw new Error(`litmos enroll ${res.status}: ${body}`);
  return body;
}

export interface LitmosCourseResult {
  CompletedDate?: string;
  Score?: number;
  PercentageComplete?: number;
}

export async function getUserCourseResult(creds: LitmosCreds, litmosUserId: string, courseId: string): Promise<LitmosCourseResult | null> {
  const res = await litmosFetch(creds, `/users/${encodeURIComponent(litmosUserId)}/courses/${encodeURIComponent(courseId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`litmos course result ${res.status}`);
  return (await res.json()) as LitmosCourseResult;
}

// ─── teams ────────────────────────────────────────────────────────────────────

export interface LitmosTeamRecord {
  Id: string;
  Name?: string;
  Description?: string;
  ParentTeamId?: string;
}

export function listLitmosTeams(creds: LitmosCreds): Promise<Record<string, unknown>[]> {
  return litmosGetAll(creds, "/teams");
}

export function listLitmosTeamUsers(creds: LitmosCreds, teamId: string): Promise<Record<string, unknown>[]> {
  return litmosGetAll(creds, `/teams/${encodeURIComponent(teamId)}/users`);
}

export async function createLitmosTeam(creds: LitmosCreds, input: { name: string; description?: string; parentTeamId?: string }): Promise<LitmosTeamRecord> {
  const path = input.parentTeamId ? `/teams/${encodeURIComponent(input.parentTeamId)}/teams` : "/teams";
  const res = await litmosFetch(creds, path, {
    method: "POST",
    body: JSON.stringify({ Id: "", Name: input.name, Description: input.description ?? "" }),
  });
  if (!res.ok) throw new Error(`litmos create team ${res.status}: ${await litmosBody(res)}`);
  const json = (await res.json().catch(() => null)) as LitmosTeamRecord | LitmosTeamRecord[] | null;
  const created = Array.isArray(json) ? json[0] : json;
  if (!created?.Id) throw new Error("litmos create team: no Id in response");
  return created;
}

export async function addLitmosTeamUsers(creds: LitmosCreds, teamId: string, litmosUserIds: string[]): Promise<void> {
  const res = await litmosFetch(creds, `/teams/${encodeURIComponent(teamId)}/users`, {
    method: "POST",
    body: JSON.stringify(litmosUserIds.map((Id) => ({ Id }))),
  });
  if (!res.ok) throw new Error(`litmos add team users ${res.status}: ${await litmosBody(res)}`);
}

export async function removeLitmosTeamUser(creds: LitmosCreds, teamId: string, litmosUserId: string): Promise<void> {
  const res = await litmosFetch(creds, `/teams/${encodeURIComponent(teamId)}/users/${encodeURIComponent(litmosUserId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`litmos remove team user ${res.status}: ${await litmosBody(res)}`);
}

export async function assignLitmosTeamCourses(creds: LitmosCreds, teamId: string, courseIds: string[]): Promise<void> {
  const res = await litmosFetch(creds, `/teams/${encodeURIComponent(teamId)}/courses`, {
    method: "POST",
    body: JSON.stringify(courseIds.map((Id) => ({ Id }))),
  });
  if (!res.ok) throw new Error(`litmos assign team courses ${res.status}: ${await litmosBody(res)}`);
}
