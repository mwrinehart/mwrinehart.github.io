// Live Litmos v1 REST client implementing LitmosSource. Mechanics per the SAP
// Litmos OpenAPI spec + developer articles, matching the conventions already
// proven in lib/modules/behavior/litmos.ts and Content Studio's publisher:
//   - `apikey` header on every call; `source=` AND `format=json` query params
//   - responses are usually bare JSON arrays with PascalCase fields, but some
//     tenants wrap them — every list read goes through extractArray()
//   - offset paging via ?limit&start, stop on a short page, hard page cap
//   - Litmos rate-limits at ~100 req/min and answers 503 (not 429) when
//     exceeded — retried here with backoff since cron ticks batch many calls
//   - PUT /users/{id} needs the FULL record with fields in spec order; updates
//     are read-modify-write through buildUserRecord()

import type {
  CourseShellInput,
  CreateUserInput,
  GamificationSummary,
  LitmosAchievement,
  LitmosBadge,
  LitmosCourse,
  LitmosCourseDetail,
  LitmosCourseUserStatus,
  LitmosLearningPath,
  LitmosModule,
  LitmosResultRow,
  LitmosTeam,
  LitmosUser,
  LitmosUserCourse,
  LitmosUserDetail,
  LitmosUserLearningPath,
  TeamGamificationEntry,
  UpdateUserInput,
} from "./types";
import { LitmosError } from "./types";
import type { LitmosCreds } from "./config";
import type { LitmosSource, ModuleAttachMode } from "./source";

const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const RETRY_DELAYS_MS = [1_000, 3_000];

export function extractArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    for (const key of ["Items", "items", "results", "data", "value", "Users", "Teams", "Courses", "LearningPaths", "Modules"]) {
      const v = (json as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

export function litmosErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    for (const key of ["Message", "message", "Error", "error"]) {
      const v = (body as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  if (status === 503) return "Litmos rate limit exceeded (HTTP 503). Try again shortly.";
  return `Litmos request failed (HTTP ${status}).`;
}

// Full user record in the spec's field order (the SAP Litmos "User" schema).
// PUT /users/{id} REPLACES the whole record, so on update every field is
// sourced from the caller's record (which updateUser reads fresh from
// GET /users/{id} before patching) — nothing is hardcoded to blank, or an
// edit to one field would wipe the user's address, phone, custom fields, etc.
export function buildUserRecord(u: Partial<LitmosUserDetail> & { UserName: string; FirstName: string; LastName: string; Email: string }) {
  return {
    Id: u.Id ?? "",
    UserName: u.UserName,
    FirstName: u.FirstName,
    LastName: u.LastName,
    FullName: u.FullName ?? `${u.FirstName} ${u.LastName}`.trim(),
    Email: u.Email,
    AccessLevel: u.AccessLevel ?? "Learner",
    DisableMessages: u.DisableMessages ?? false,
    Active: u.Active ?? true,
    Skype: u.Skype ?? "",
    PhoneWork: u.PhoneWork ?? "",
    PhoneMobile: u.PhoneMobile ?? "",
    LastLogin: u.LastLogin ?? "",
    LoginKey: u.LoginKey ?? "",
    IsCustomUsername: u.IsCustomUsername ?? false,
    Password: "",
    SkipFirstLogin: u.SkipFirstLogin ?? false,
    TimeZone: u.TimeZone ?? "",
    SalesforceId: u.SalesforceId ?? "",
    Street1: u.Street1 ?? "",
    Street2: u.Street2 ?? "",
    City: u.City ?? "",
    State: u.State ?? "",
    PostalCode: u.PostalCode ?? "",
    Country: u.Country ?? "",
    SalesforceContactId: u.SalesforceContactId ?? "",
    SalesforceAccountId: u.SalesforceAccountId ?? "",
    CompanyName: u.CompanyName ?? "",
    JobTitle: u.JobTitle ?? "",
    CustomField1: u.CustomField1 ?? "",
    CustomField2: u.CustomField2 ?? "",
    CustomField3: u.CustomField3 ?? "",
    CustomField4: u.CustomField4 ?? "",
    CustomField5: u.CustomField5 ?? "",
    CustomField6: u.CustomField6 ?? "",
    CustomField7: u.CustomField7 ?? "",
    CustomField8: u.CustomField8 ?? "",
    CustomField9: u.CustomField9 ?? "",
    CustomField10: u.CustomField10 ?? "",
    Culture: u.Culture ?? "",
    Brand: u.Brand ?? "",
    ManagerId: u.ManagerId ?? "",
    EnableTextNotification: u.EnableTextNotification ?? false,
    Website: u.Website ?? "",
    Twitter: u.Twitter ?? "",
    ExpirationDate: u.ExpirationDate ?? "",
    JobRole: u.JobRole ?? "",
    ExternalEmployeeId: u.ExternalEmployeeId ?? "",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiveLitmosSource implements LitmosSource {
  readonly mode = "live" as const;
  private readonly creds: LitmosCreds;

  constructor(creds: LitmosCreds) {
    this.creds = creds;
  }

  private url(path: string, params?: Record<string, string>): string {
    const sep = path.includes("?") ? "&" : "?";
    let url = `${this.creds.base}${path}${sep}source=${encodeURIComponent(this.creds.source)}&format=json`;
    for (const [k, v] of Object.entries(params ?? {})) {
      url += `&${k}=${encodeURIComponent(v)}`;
    }
    return url;
  }

  private async request(method: string, path: string, opts?: { params?: Record<string, string>; body?: unknown }): Promise<unknown> {
    const url = this.url(path, opts?.params);
    let lastError: LitmosError | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          apikey: this.creds.apiKey,
          accept: "application/json",
          // Litmos requires Content-Type on all write calls, including
          // empty-body PUTs like team-admin promotion and course reset.
          ...(method === "GET" ? {} : { "content-type": "application/json" }),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (res.ok) return data;
      lastError = new LitmosError(res.status, litmosErrorMessage(res.status, data));
      // 503 = rate limit; anything else is not retryable.
      if (res.status !== 503 || attempt === RETRY_DELAYS_MS.length) throw lastError;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
    throw lastError ?? new LitmosError(500, "Litmos request failed.");
  }

  private async paged(path: string, params?: Record<string, string>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = extractArray(
        await this.request("GET", path, { params: { ...params, limit: String(PAGE_SIZE), start: String(page * PAGE_SIZE) } }),
      );
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  // ── users ──────────────────────────────────────────────────────────────────

  async listUsers(opts?: { search?: string }): Promise<LitmosUser[]> {
    const params: Record<string, string> = {};
    if (opts?.search) params.search = opts.search;
    return (await this.paged("/users", params)) as unknown as LitmosUser[];
  }

  async getUser(id: string): Promise<LitmosUserDetail | null> {
    try {
      return (await this.request("GET", `/users/${encodeURIComponent(id)}`)) as LitmosUserDetail;
    } catch (e) {
      if (e instanceof LitmosError && e.status === 404) return null;
      throw e;
    }
  }

  async findUserByEmail(email: string): Promise<LitmosUser | null> {
    const target = email.trim().toLowerCase();
    if (!target) return null;
    // `search` matches username/name/email substrings server-side; still verify
    // the exact email match client-side.
    const rows = await this.listUsers({ search: target });
    return rows.find((u) => String(u.Email ?? "").toLowerCase() === target || String(u.UserName ?? "").toLowerCase() === target) ?? null;
  }

  async createUser(input: CreateUserInput): Promise<LitmosUserDetail> {
    const record = buildUserRecord({
      UserName: input.Email.trim().toLowerCase(),
      FirstName: input.FirstName,
      LastName: input.LastName,
      Email: input.Email.trim(),
      AccessLevel: input.AccessLevel ?? "Learner",
      CompanyName: input.CompanyName,
      JobTitle: input.JobTitle,
      Brand: input.Brand,
    });
    const params: Record<string, string> = {};
    if (input.sendWelcomeEmail) params.sendmessage = "true";
    const created = await this.request("POST", "/users", { params, body: record });
    return created as LitmosUserDetail;
  }

  async updateUser(id: string, patch: UpdateUserInput): Promise<void> {
    const current = await this.getUser(id);
    if (!current) throw new LitmosError(404, "User not found in Litmos.");
    const record = buildUserRecord({
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      UserName: patch.Email?.trim().toLowerCase() ?? current.UserName,
      Id: id,
    });
    await this.request("PUT", `/users/${encodeURIComponent(id)}`, { body: record });
  }

  // ── teams ──────────────────────────────────────────────────────────────────

  async listTeams(): Promise<LitmosTeam[]> {
    return (await this.paged("/teams")) as unknown as LitmosTeam[];
  }

  async getTeam(id: string): Promise<LitmosTeam | null> {
    try {
      return (await this.request("GET", `/teams/${encodeURIComponent(id)}`)) as LitmosTeam;
    } catch (e) {
      if (e instanceof LitmosError && e.status === 404) return null;
      throw e;
    }
  }

  async createSubTeam(parentId: string, name: string, description?: string): Promise<LitmosTeam> {
    const created = await this.request("POST", `/teams/${encodeURIComponent(parentId)}/teams`, {
      body: { Id: "", Name: name, Description: description ?? "" },
    });
    return created as LitmosTeam;
  }

  async listTeamUsers(teamId: string): Promise<LitmosUser[]> {
    return (await this.paged(`/teams/${encodeURIComponent(teamId)}/users`)) as unknown as LitmosUser[];
  }

  async addUsersToTeam(teamId: string, userIds: string[], sendMessage: boolean): Promise<void> {
    if (!userIds.length) return;
    await this.request("POST", `/teams/${encodeURIComponent(teamId)}/users`, {
      params: sendMessage ? { sendmessage: "true" } : {},
      body: userIds.map((id) => ({ Id: id })),
    });
  }

  async removeUserFromTeam(teamId: string, userId: string): Promise<void> {
    await this.request("DELETE", `/teams/${encodeURIComponent(teamId)}/users/${encodeURIComponent(userId)}`);
  }

  async listUserTeams(userId: string): Promise<LitmosTeam[]> {
    return extractArray(await this.request("GET", `/users/${encodeURIComponent(userId)}/teams`)) as unknown as LitmosTeam[];
  }

  async listTeamAdmins(teamId: string): Promise<LitmosUser[]> {
    return (await this.paged(`/teams/${encodeURIComponent(teamId)}/admins`)) as unknown as LitmosUser[];
  }

  async listTeamLeaders(teamId: string): Promise<LitmosUser[]> {
    return (await this.paged(`/teams/${encodeURIComponent(teamId)}/leaders`)) as unknown as LitmosUser[];
  }

  // Promotion requires prior team membership (Litmos 404s otherwise) — callers
  // add the user to the team first.
  async promoteTeamAdmin(teamId: string, userId: string): Promise<void> {
    await this.request("PUT", `/teams/${encodeURIComponent(teamId)}/admins/${encodeURIComponent(userId)}`, { body: {} });
  }

  async demoteTeamAdmin(teamId: string, userId: string): Promise<void> {
    await this.request("DELETE", `/teams/${encodeURIComponent(teamId)}/admins/${encodeURIComponent(userId)}`);
  }

  async promoteTeamLeader(teamId: string, userId: string): Promise<void> {
    await this.request("PUT", `/teams/${encodeURIComponent(teamId)}/leaders/${encodeURIComponent(userId)}`, { body: {} });
  }

  async demoteTeamLeader(teamId: string, userId: string): Promise<void> {
    await this.request("DELETE", `/teams/${encodeURIComponent(teamId)}/leaders/${encodeURIComponent(userId)}`);
  }

  // ── courses & library ──────────────────────────────────────────────────────

  async listCourses(): Promise<LitmosCourse[]> {
    return (await this.paged("/courses")) as unknown as LitmosCourse[];
  }

  async getCourseDetails(id: string): Promise<LitmosCourseDetail | null> {
    try {
      return (await this.request("GET", `/courses/${encodeURIComponent(id)}/details`)) as LitmosCourseDetail;
    } catch (e) {
      if (e instanceof LitmosError && e.status === 404) return null;
      throw e;
    }
  }

  async listCourseModules(courseId: string): Promise<LitmosModule[]> {
    return extractArray(await this.request("GET", `/courses/${encodeURIComponent(courseId)}/modules`)) as unknown as LitmosModule[];
  }

  async listCourseUsers(courseId: string): Promise<LitmosCourseUserStatus[]> {
    return (await this.paged(`/courses/${encodeURIComponent(courseId)}/users`)) as unknown as LitmosCourseUserStatus[];
  }

  async upsertCourseShell(input: CourseShellInput): Promise<void> {
    // Async bulk job; max 100 records per request (we always send one).
    await this.request("POST", "/bulkimports/courses", {
      body: {
        CourseImport: [
          {
            CourseTitle: input.CourseTitle,
            CourseCode: input.CourseCode,
            Description: input.Description ?? "",
            Active: input.Active,
            ...(input.ContentLibrary !== undefined ? { ContentLibrary: input.ContentLibrary } : {}),
            ...(input.DueDate ? { DueDate: input.DueDate } : {}),
            ...(input.DueDateSpan != null ? { DueDateSpan: input.DueDateSpan } : {}),
            ...(input.ComplianceDateSpan != null ? { ComplianceDateSpan: input.ComplianceDateSpan } : {}),
            ...(input.ComplianceRetake !== undefined ? { ComplianceRetake: input.ComplianceRetake } : {}),
          },
        ],
      },
    });
  }

  async findCourseByCode(code: string): Promise<LitmosCourse | null> {
    const target = code.trim().toLowerCase();
    const rows = (await this.paged("/courses", { search: code.trim() })) as unknown as LitmosCourse[];
    return rows.find((c) => String(c.Code ?? "").toLowerCase() === target) ?? null;
  }

  async attachModules(courseId: string, moduleIds: string[], mode: ModuleAttachMode): Promise<void> {
    if (!moduleIds.length) return;
    await this.request("POST", `/courses/${encodeURIComponent(courseId)}/modules/${mode}`, {
      body: moduleIds.map((id) => ({ Id: id })),
    });
  }

  // ── team content ───────────────────────────────────────────────────────────

  async listTeamCourses(teamId: string): Promise<LitmosCourse[]> {
    return (await this.paged(`/teams/${encodeURIComponent(teamId)}/courses`)) as unknown as LitmosCourse[];
  }

  async assignCoursesToTeam(teamId: string, courseIds: string[], opts: { library: boolean; includeSubteams: boolean }): Promise<void> {
    if (!courseIds.length) return;
    await this.request("POST", `/teams/${encodeURIComponent(teamId)}/courses`, {
      params: opts.includeSubteams ? { includesubteams: "true" } : {},
      // The support article documents { Id, CourseTeamLibrary }; the 2021
      // OpenAPI snapshot says { CourseId }. Send both id spellings.
      body: courseIds.map((id) => ({ Id: id, CourseId: id, CourseTeamLibrary: opts.library })),
    });
  }

  async unassignCoursesFromTeam(teamId: string, courseIds: string[], library: boolean): Promise<void> {
    if (!courseIds.length) return;
    await this.request("DELETE", `/teams/${encodeURIComponent(teamId)}/courses`, {
      body: courseIds.map((id) => ({ Id: id, CourseId: id, CourseTeamLibrary: library })),
    });
  }

  async listTeamLearningPaths(teamId: string): Promise<LitmosLearningPath[]> {
    return (await this.paged(`/teams/${encodeURIComponent(teamId)}/learningpaths`)) as unknown as LitmosLearningPath[];
  }

  async assignLearningPathsToTeam(teamId: string, lpIds: string[]): Promise<void> {
    if (!lpIds.length) return;
    // This endpoint's documented key is LearningPathId (unlike the per-user
    // endpoint, which uses Id) — send both.
    await this.request("POST", `/teams/${encodeURIComponent(teamId)}/learningpaths`, {
      body: lpIds.map((id) => ({ Id: id, LearningPathId: id })),
    });
  }

  async unassignLearningPathsFromTeam(teamId: string, lpIds: string[]): Promise<void> {
    if (!lpIds.length) return;
    await this.request("DELETE", `/teams/${encodeURIComponent(teamId)}/learningpaths`, {
      body: lpIds.map((id) => ({ Id: id, LearningPathId: id })),
    });
  }

  // ── learning paths ─────────────────────────────────────────────────────────

  async listLearningPaths(): Promise<LitmosLearningPath[]> {
    return (await this.paged("/learningpaths")) as unknown as LitmosLearningPath[];
  }

  async listLearningPathCourses(lpId: string): Promise<LitmosCourse[]> {
    return extractArray(await this.request("GET", `/learningpaths/${encodeURIComponent(lpId)}/courses`)) as unknown as LitmosCourse[];
  }

  // ── per-user assignments ───────────────────────────────────────────────────

  async listUserCourses(userId: string): Promise<LitmosUserCourse[]> {
    return (await this.paged(`/users/${encodeURIComponent(userId)}/courses`)) as unknown as LitmosUserCourse[];
  }

  async assignCoursesToUser(userId: string, courseIds: string[], sendMessage: boolean): Promise<void> {
    if (!courseIds.length) return;
    // Assignment emails are ON by default for this endpoint — suppression must
    // be explicit, unlike everywhere else in the API.
    await this.request("POST", `/users/${encodeURIComponent(userId)}/courses`, {
      params: { sendmessage: sendMessage ? "true" : "false" },
      body: courseIds.map((id) => ({ Id: id })),
    });
  }

  async unassignCourseFromUser(userId: string, courseId: string): Promise<void> {
    await this.request("DELETE", `/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}`);
  }

  async listUserLearningPaths(userId: string): Promise<LitmosUserLearningPath[]> {
    return (await this.paged(`/users/${encodeURIComponent(userId)}/learningpaths`)) as unknown as LitmosUserLearningPath[];
  }

  async assignLearningPathsToUser(userId: string, lpIds: string[]): Promise<void> {
    if (!lpIds.length) return;
    await this.request("POST", `/users/${encodeURIComponent(userId)}/learningpaths`, {
      body: lpIds.map((id) => ({ Id: id })),
    });
  }

  async unassignLearningPathFromUser(userId: string, lpId: string): Promise<void> {
    await this.request("DELETE", `/users/${encodeURIComponent(userId)}/learningpaths/${encodeURIComponent(lpId)}`);
  }

  async resetUserCourse(userId: string, courseId: string): Promise<void> {
    await this.request("PUT", `/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/reset`, { body: {} });
  }

  // ── gamification ───────────────────────────────────────────────────────────

  async getUserGamificationSummary(userId: string): Promise<GamificationSummary> {
    return (await this.request("GET", `/users/${encodeURIComponent(userId)}/gamificationsummary`)) as GamificationSummary;
  }

  async listUserBadges(userId: string): Promise<LitmosBadge[]> {
    return extractArray(await this.request("GET", `/users/${encodeURIComponent(userId)}/badges`)) as unknown as LitmosBadge[];
  }

  async getTeamGamificationDetails(teamId: string): Promise<TeamGamificationEntry[]> {
    return extractArray(
      await this.request("GET", `/teams/${encodeURIComponent(teamId)}/gamificationdetails`),
    ) as unknown as TeamGamificationEntry[];
  }

  async resetUserGamification(userId: string): Promise<void> {
    await this.request("PUT", `/users/${encodeURIComponent(userId)}/gamificationreset`, { body: {} });
  }

  // ── reporting ──────────────────────────────────────────────────────────────

  async listResultsSince(sinceIso: string): Promise<LitmosResultRow[]> {
    const to = new Date().toISOString().slice(0, 19).replace("T", " ");
    const since = sinceIso.slice(0, 19).replace("T", " ");
    return (await this.paged("/results/details", { since, to })) as unknown as LitmosResultRow[];
  }

  async listAchievements(opts: { since?: string; userId?: string }): Promise<LitmosAchievement[]> {
    const params: Record<string, string> = {};
    if (opts.since) params.since = opts.since.slice(0, 10);
    if (opts.userId) params.userid = opts.userId;
    return (await this.paged("/achievements", params)) as unknown as LitmosAchievement[];
  }
}
