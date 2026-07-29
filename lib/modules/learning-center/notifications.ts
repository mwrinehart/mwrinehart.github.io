// Learning Center notifications. Litmos has NO API for its email templates and
// no "resend" endpoint, so the dashboard owns this layer entirely:
//   - per-team templates (welcome / assignment / due & compliance reminders /
//     custom), editable ONLY when the team runs a custom brand — teams on the
//     Jericho/default brands use centrally managed messaging and see the page
//     read-only (requirement: manage notifications for YOUR brand only).
//   - manual trigger/resend: login links are rebuilt from the Litmos LoginKey
//     (fetched fresh per user) and sent through the platform mailer; reminders
//     and custom messages send the same way.
//   - a daily cron sweep (`lc-reminders`) sends due-soon / overdue /
//     compliance-expiring reminders wherever an active template exists.

import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { notify } from "@/lib/platform/notify";
import {
  lcNotificationSends,
  lcNotificationTemplates,
  type LcNotificationSendRow,
  type LcNotificationTemplateRow,
} from "./schema";
import type { LitmosSource } from "./source";
import type { LitmosTeam, LitmosUser } from "./types";
import { isDefaultBrand, learnerPortalUrl } from "./config";
import { descendantTeamIds } from "./scope";

const DAY = 86_400_000;
// A learner gets at most one automatic reminder of a given type per 6 days.
const REMINDER_COOLDOWN_MS = 6 * DAY;

export type TemplateType = "welcome" | "assignment" | "due_reminder" | "compliance_reminder" | "custom";

export const TEMPLATE_TYPES: Array<{ type: TemplateType; label: string; hint: string }> = [
  { type: "welcome", label: "Welcome / login link", hint: "Sent when you (re)send someone their sign-in link." },
  { type: "assignment", label: "New assignment", hint: "Sent when you notify learners about newly assigned training." },
  { type: "due_reminder", label: "Due date reminder", hint: "Sent to learners with training due soon or overdue." },
  { type: "compliance_reminder", label: "Compliance reminder", hint: "Sent when a certification window is expiring or lapsed." },
  { type: "custom", label: "Custom message", hint: "Free-form message to your team." },
];

// Placeholders resolved per recipient at send time.
export const TEMPLATE_PLACEHOLDERS = [
  "{{first_name}}",
  "{{last_name}}",
  "{{email}}",
  "{{team_name}}",
  "{{course_name}}",
  "{{due_date}}",
  "{{compliance_date}}",
  "{{login_link}}",
] as const;

export function renderTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null || v === "" ? "" : String(v);
  });
}

export const DEFAULT_TEMPLATES: Record<TemplateType, { name: string; subject: string; body: string }> = {
  welcome: {
    name: "Welcome to the Learning Center",
    subject: "Your {{team_name}} security training is ready",
    body: "Hi {{first_name}},\n\nYour security training account is ready. Sign in here:\n{{login_link}}\n\nThis link signs you straight in — keep it private.\n\n— {{team_name}} Security Training",
  },
  assignment: {
    name: "New training assigned",
    subject: "New security training assigned: {{course_name}}",
    body: "Hi {{first_name}},\n\nYou've been assigned {{course_name}}. Sign in to start:\n{{login_link}}\n\n— {{team_name}} Security Training",
  },
  due_reminder: {
    name: "Training due reminder",
    subject: "Reminder: {{course_name}} is due {{due_date}}",
    body: "Hi {{first_name}},\n\n{{course_name}} is due {{due_date}}. A few minutes now keeps you off the overdue list.\n{{login_link}}\n\n— {{team_name}} Security Training",
  },
  compliance_reminder: {
    name: "Certification expiring",
    subject: "Action needed: {{course_name}} certification expires {{compliance_date}}",
    body: "Hi {{first_name}},\n\nYour {{course_name}} certification expires {{compliance_date}}. Please recertify before then.\n{{login_link}}\n\n— {{team_name}} Security Training",
  },
  custom: {
    name: "Message to the team",
    subject: "A note from your training team",
    body: "Hi {{first_name}},\n\n(Write your message here.)\n\n— {{team_name}} Security Training",
  },
};

// ─── brand resolution ─────────────────────────────────────────────────────────

// A team's brand = the most common non-empty Brand among its active members
// (Litmos brands are per-user; teams push users into a brand). Empty = default.
export function pickTeamBrand(memberBrands: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const raw of memberBrands) {
    const b = (raw ?? "").trim();
    if (!b) continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [brand, count] of counts) {
    if (count > bestCount) {
      best = brand;
      bestCount = count;
    }
  }
  return best;
}

export interface TeamBrandInfo {
  brand: string | null;
  // True when the team may manage its own notification templates here.
  manageable: boolean;
}

export async function getTeamBrand(source: LitmosSource, teamId: string): Promise<TeamBrandInfo> {
  const members = await source.listTeamUsers(teamId);
  const brand = pickTeamBrand(members.map((m) => m.Brand));
  return { brand, manageable: !isDefaultBrand(brand) };
}

// ─── templates ────────────────────────────────────────────────────────────────

export async function listTemplates(teamId: string): Promise<LcNotificationTemplateRow[]> {
  return db
    .select()
    .from(lcNotificationTemplates)
    .where(eq(lcNotificationTemplates.teamId, teamId))
    .orderBy(desc(lcNotificationTemplates.updatedAt));
}

export async function saveTemplate(input: {
  id?: string;
  teamId: string;
  brand: string | null;
  type: TemplateType;
  name: string;
  subject: string;
  body: string;
  active: boolean;
  updatedBy: string;
}): Promise<string> {
  const now = Date.now();
  if (input.id) {
    await db
      .update(lcNotificationTemplates)
      .set({ name: input.name, subject: input.subject, body: input.body, active: input.active, updatedBy: input.updatedBy, updatedAt: now })
      .where(and(eq(lcNotificationTemplates.id, input.id), eq(lcNotificationTemplates.teamId, input.teamId)));
    return input.id;
  }
  const id = randomUUID();
  await db.insert(lcNotificationTemplates).values({
    id,
    teamId: input.teamId,
    brand: input.brand,
    type: input.type,
    name: input.name,
    subject: input.subject,
    body: input.body,
    active: input.active,
    updatedBy: input.updatedBy,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function deleteTemplate(teamId: string, id: string): Promise<void> {
  await db.delete(lcNotificationTemplates).where(and(eq(lcNotificationTemplates.id, id), eq(lcNotificationTemplates.teamId, teamId)));
}

// Template used for a send: the team's active template of that type, falling
// back to the built-in default copy.
export async function templateFor(teamId: string, type: TemplateType): Promise<{ subject: string; body: string; templateId: string | null }> {
  const rows = await db
    .select()
    .from(lcNotificationTemplates)
    .where(and(eq(lcNotificationTemplates.teamId, teamId), eq(lcNotificationTemplates.type, type), eq(lcNotificationTemplates.active, true)))
    .orderBy(desc(lcNotificationTemplates.updatedAt))
    .limit(1);
  const row = rows[0];
  if (row) return { subject: row.subject, body: row.body, templateId: row.id };
  const d = DEFAULT_TEMPLATES[type];
  return { subject: d.subject, body: d.body, templateId: null };
}

// ─── sending ──────────────────────────────────────────────────────────────────

export interface SendRecipient {
  user: LitmosUser;
  vars?: Record<string, string | null | undefined>;
}

export interface SendOutcome {
  sent: number;
  failed: number;
  skipped: number;
  status: "sent" | "partial" | "failed" | "skipped";
}

// Fetches a fresh LoginKey per recipient — Litmos regenerates it, and it's the
// only API mechanism for a working "(re)send login/welcome" flow.
async function loginLinkFor(source: LitmosSource, userId: string): Promise<string> {
  try {
    const detail = await source.getUser(userId);
    if (detail?.LoginKey) return detail.LoginKey;
  } catch {
    // fall through to the portal URL
  }
  return learnerPortalUrl();
}

export async function sendNotification(opts: {
  source: LitmosSource;
  teamId: string;
  teamName: string;
  type: TemplateType;
  recipients: SendRecipient[];
  sentBy: string;
  subjectOverride?: string;
  bodyOverride?: string;
  extraVars?: Record<string, string | null | undefined>;
}): Promise<SendOutcome> {
  const tpl = await templateFor(opts.teamId, opts.type);
  const subjectTemplate = opts.subjectOverride ?? tpl.subject;
  const bodyTemplate = opts.bodyOverride ?? tpl.body;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const sentEmails: string[] = [];

  for (const { user, vars } of opts.recipients) {
    if (!user.Email) {
      skipped++;
      continue;
    }
    const loginLink = await loginLinkFor(opts.source, user.Id);
    const allVars = {
      first_name: user.FirstName,
      last_name: user.LastName,
      email: user.Email,
      team_name: opts.teamName,
      login_link: loginLink,
      ...opts.extraVars,
      ...vars,
    };
    const result = await notify({
      orgId: null,
      channel: "email",
      target: user.Email,
      subject: renderTemplate(subjectTemplate, allVars),
      body: renderTemplate(bodyTemplate, allVars),
      module: "learning-center",
    });
    if (result.status === "sent") {
      sent++;
      sentEmails.push(user.Email);
    } else if (result.status === "failed") failed++;
    else skipped++;
  }

  const status: SendOutcome["status"] = sent === 0 ? (failed > 0 ? "failed" : "skipped") : failed > 0 || skipped > 0 ? "partial" : "sent";
  await db.insert(lcNotificationSends).values({
    id: randomUUID(),
    teamId: opts.teamId,
    templateId: null,
    type: opts.type,
    subject: renderTemplate(subjectTemplate, { team_name: opts.teamName, first_name: "…", course_name: opts.extraVars?.course_name ?? "" }),
    recipientCount: opts.recipients.length,
    recipients: JSON.stringify(opts.recipients.map((r) => r.user.Email)),
    deliveredTo: JSON.stringify(sentEmails),
    status,
    error: failed ? `${failed} send(s) failed` : skipped && !sent ? "SMTP not configured — sends were skipped" : null,
    sentBy: opts.sentBy,
    createdAt: Date.now(),
  });
  return { sent, failed, skipped, status };
}

export async function listSends(scopeTeamIds: string[] | null, limit = 100): Promise<LcNotificationSendRow[]> {
  if (scopeTeamIds === null) {
    return db.select().from(lcNotificationSends).orderBy(desc(lcNotificationSends.createdAt)).limit(limit);
  }
  if (!scopeTeamIds.length) return [];
  return db
    .select()
    .from(lcNotificationSends)
    .where(inArray(lcNotificationSends.teamId, scopeTeamIds))
    .orderBy(desc(lcNotificationSends.createdAt))
    .limit(limit);
}

// ─── cron reminder sweep ──────────────────────────────────────────────────────

interface ReminderCandidate {
  user: LitmosUser;
  type: "due_reminder" | "compliance_reminder";
  vars: Record<string, string>;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "soon";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "soon";
  return new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Emails ACTUALLY reminded with this type recently (parsed from the send log).
// Only "sent"/"partial" rows count — a "skipped" sweep (SMTP unconfigured) or a
// "failed" one must NOT poison the cooldown, or once SMTP is fixed every learner
// would stay suppressed until the phantom rows age out.
async function recentlyReminded(teamId: string, type: TemplateType): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(lcNotificationSends)
    .where(
      and(
        eq(lcNotificationSends.teamId, teamId),
        eq(lcNotificationSends.type, type),
        inArray(lcNotificationSends.status, ["sent", "partial"]),
        gte(lcNotificationSends.createdAt, Date.now() - REMINDER_COOLDOWN_MS),
      ),
    );
  const out = new Set<string>();
  for (const row of rows) {
    try {
      const parsed: unknown = JSON.parse(row.deliveredTo ?? row.recipients ?? "[]");
      if (Array.isArray(parsed)) for (const e of parsed) out.add(String(e).toLowerCase());
    } catch {
      // ignore malformed log rows
    }
  }
  return out;
}

// Sweep every team that has an ACTIVE reminder template: find members with
// due-soon/overdue training or expiring/lapsed certifications and send the
// team's templated reminder, respecting the per-user cooldown.
export async function runReminderSweep(source: LitmosSource): Promise<{ teams: number; sent: number }> {
  const templates = await db
    .select()
    .from(lcNotificationTemplates)
    .where(and(eq(lcNotificationTemplates.active, true), inArray(lcNotificationTemplates.type, ["due_reminder", "compliance_reminder"])));
  const teamIds = [...new Set(templates.map((t) => t.teamId))];
  if (!teamIds.length) return { teams: 0, sent: 0 };

  const allTeams = await source.listTeams();
  const now = Date.now();
  let totalSent = 0;

  for (const teamId of teamIds) {
    const team = allTeams.find((t: LitmosTeam) => t.Id === teamId);
    if (!team) continue;
    const types = new Set(templates.filter((t) => t.teamId === teamId).map((t) => t.type));
    const members = await source.listTeamUsers(teamId);

    const candidates: ReminderCandidate[] = [];
    for (const member of members) {
      if (!member.Email) continue; // can't remind someone with no email on record
      let courses;
      try {
        courses = await source.listUserCourses(member.Id);
      } catch {
        continue;
      }
      for (const c of courses) {
        if (types.has("compliance_reminder") && c.ComplaintTill) {
          const till = Date.parse(c.ComplaintTill);
          if (!Number.isNaN(till) && till - now < 14 * DAY) {
            candidates.push({
              user: member,
              type: "compliance_reminder",
              vars: { course_name: c.Name, compliance_date: fmtDate(c.ComplaintTill) },
            });
            continue;
          }
        }
        if (types.has("due_reminder") && !c.Complete && c.Overdue) {
          candidates.push({ user: member, type: "due_reminder", vars: { course_name: c.Name, due_date: "now (overdue)" } });
        }
      }
    }

    for (const type of ["due_reminder", "compliance_reminder"] as const) {
      const forType = candidates.filter((c) => c.type === type);
      if (!forType.length) continue;
      const cooldown = await recentlyReminded(teamId, type);
      // One email per user per sweep — pick their first matching course.
      const byUser = new Map<string, ReminderCandidate>();
      for (const c of forType) {
        if (!cooldown.has(c.user.Email.toLowerCase()) && !byUser.has(c.user.Id)) byUser.set(c.user.Id, c);
      }
      if (!byUser.size) continue;
      const outcome = await sendNotification({
        source,
        teamId,
        teamName: team.Name,
        type,
        recipients: [...byUser.values()].map((c) => ({ user: c.user, vars: c.vars })),
        sentBy: "cron",
      });
      totalSent += outcome.sent;
    }
  }
  return { teams: teamIds.length, sent: totalSent };
}
