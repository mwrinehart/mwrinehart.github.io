// LMS rules engine: tenant-configurable "when X, do Y" automations. Rules are
// stored as JSON condition/action blobs (tolerant-parsed via types.ts), matched
// against LmsEvents fired from sync/webhooks/cron, and made idempotent by the
// lms_rule_runs ledger — the unique (ruleId, dedupeKey) insert is the gate, so
// re-delivered events never double-execute actions.

import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { addLitmosTeamUsers, findLitmosUserByEmail, getLitmosCreds } from "@/lib/platform/litmos";
import { notify } from "@/lib/platform/notify";
import { createLmsAssignments } from "./assignments";
import { sendLmsNotice } from "./notifications";
import { lmsRules, lmsRuleRuns, lmsTeamMembers, type LmsRuleRow, type LmsRuleRunRow } from "./schema";
import {
  coerceRuleAction,
  eventDedupeKey,
  parseRuleActions,
  parseRuleConditions,
  renderTemplate,
  ruleMatches,
  RULE_TRIGGERS,
  type LmsEvent,
  type RuleAction,
  type RuleConditions,
  type RuleTrigger,
} from "./types";

const DAY_MS = 86_400_000;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listRules(orgId: string): Promise<LmsRuleRow[]> {
  return db.select().from(lmsRules).where(eq(lmsRules.orgId, orgId)).orderBy(desc(lmsRules.createdAt));
}

export async function getRule(orgId: string, id: string): Promise<LmsRuleRow | null> {
  const [row] = await db
    .select()
    .from(lmsRules)
    .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.id, id)));
  return row ?? null;
}

// Shared create/update validation: unknown triggers and action-less rules are
// rejected outright rather than persisted and silently skipped at fire time.
function validateRuleInput(trigger: RuleTrigger, actions: RuleAction[]): RuleAction[] {
  if (!RULE_TRIGGERS.some((t) => t.value === trigger)) throw new Error(`Unknown rule trigger: ${trigger}`);
  const valid = actions.map(coerceRuleAction).filter((a): a is RuleAction => a !== null);
  if (!valid.length) throw new Error("Rule needs at least one valid action");
  return valid;
}

export async function createRule(
  orgId: string,
  createdBy: string,
  input: { name: string; description?: string; trigger: RuleTrigger; conditions: RuleConditions; actions: RuleAction[]; enabled?: boolean },
): Promise<string> {
  const actions = validateRuleInput(input.trigger, input.actions);
  const id = randomUUID();
  const now = Date.now();
  await db.insert(lmsRules).values({
    id,
    orgId,
    name: input.name,
    description: input.description ?? null,
    trigger: input.trigger,
    conditions: JSON.stringify(input.conditions),
    actions: JSON.stringify(actions),
    enabled: input.enabled ?? true,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateRule(
  orgId: string,
  id: string,
  input: { name: string; description?: string; trigger: RuleTrigger; conditions: RuleConditions; actions: RuleAction[]; enabled: boolean },
): Promise<void> {
  const actions = validateRuleInput(input.trigger, input.actions);
  await db
    .update(lmsRules)
    .set({
      name: input.name,
      description: input.description ?? null,
      trigger: input.trigger,
      conditions: JSON.stringify(input.conditions),
      actions: JSON.stringify(actions),
      enabled: input.enabled,
      updatedAt: Date.now(),
    })
    .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.id, id)));
}

export async function deleteRule(orgId: string, id: string): Promise<void> {
  await db.delete(lmsRules).where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.id, id)));
}

export async function setRuleEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db
    .update(lmsRules)
    .set({ enabled, updatedAt: Date.now() })
    .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.id, id)));
}

export function listRuleRuns(orgId: string, limit = 50): Promise<LmsRuleRunRow[]> {
  return db.select().from(lmsRuleRuns).where(eq(lmsRuleRuns.orgId, orgId)).orderBy(desc(lmsRuleRuns.firedAt)).limit(limit);
}

// ─── template vars ────────────────────────────────────────────────────────────

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}

function eventVars(event: LmsEvent): Record<string, string | number> {
  return {
    learner: event.learner?.name || event.learner?.email || "",
    learnerEmail: event.learner?.email ?? "",
    course: event.course?.name || event.course?.litmosId || "",
    courseId: event.course?.litmosId ?? "",
    dueDate: fmtDate(event.assignment?.dueDate),
    daysLeft: event.daysLeft ?? "",
    daysOverdue: event.daysOverdue ?? "",
    daysToExpiry: event.daysToExpiry ?? "",
    score: event.assignment?.score ?? "",
  };
}

// Fallback bodies for notify/notify_learner actions without a custom message.
const DEFAULT_RULE_MESSAGES: Record<RuleTrigger, string> = {
  "learner.created": "New learner {{learner}} was created in Litmos.",
  "learner.team_joined": "{{learner}} joined a team.",
  "assignment.completed": '{{learner}} completed "{{course}}".',
  "assignment.due_soon": '{{learner}}\'s training "{{course}}" is due in {{daysLeft}} day(s).',
  "assignment.overdue": '{{learner}}\'s training "{{course}}" is {{daysOverdue}} day(s) overdue.',
  "compliance.expiring": '{{learner}}\'s compliance credit for "{{course}}" expires in {{daysToExpiry}} day(s).',
  "schedule.daily": "Daily training check for {{learner}}.",
};

function defaultMessage(trigger: string): string {
  return DEFAULT_RULE_MESSAGES[trigger as RuleTrigger] ?? "LMS rule fired for {{learner}}.";
}

// ─── action execution ─────────────────────────────────────────────────────────

async function runAssignCourse(orgId: string, rule: LmsRuleRow, action: Extract<RuleAction, { type: "assign_course" }>, event: LmsEvent): Promise<string> {
  const learnerEmail = event.learner?.email;
  if (!learnerEmail) throw new Error("event has no learner email");
  const dueDate = action.dueInDays ? Date.now() + action.dueInDays * DAY_MS : undefined;
  const { created, skipped } = await createLmsAssignments(orgId, [
    {
      learnerEmail,
      learnerName: event.learner?.name ?? undefined,
      courseLitmosId: action.courseId,
      courseName: action.courseName,
      dueDate,
      assignedBy: `rule:${rule.id}`,
      ruleId: rule.id,
    },
  ]);
  if (created > 0) {
    await sendLmsNotice(
      orgId,
      "assignment_created",
      {
        ...eventVars(event),
        course: action.courseName || action.courseId,
        courseId: action.courseId,
        dueDate: fmtDate(dueDate),
        dueClause: dueDate ? `, due ${fmtDate(dueDate)}` : "",
      },
      { learnerEmail },
    );
  }
  return `created ${created}, skipped ${skipped}`;
}

async function runAddToTeam(orgId: string, action: Extract<RuleAction, { type: "add_to_team" }>, event: LmsEvent): Promise<string> {
  const creds = await getLitmosCreds(orgId);
  if (!creds) throw new Error("Litmos API key not configured");
  let litmosUserId = event.learner?.litmosUserId ?? null;
  if (!litmosUserId) {
    const email = event.learner?.email;
    if (!email) throw new Error("event has no learner email");
    const user = await findLitmosUserByEmail(creds, email);
    if (!user?.Id) throw new Error(`user not found in Litmos: ${email}`);
    litmosUserId = String(user.Id);
  }
  await addLitmosTeamUsers(creds, action.teamId, [litmosUserId]);
  // Mirror immediately so the membership shows up before the next full sync.
  await db
    .insert(lmsTeamMembers)
    .values({ id: randomUUID(), orgId, teamLitmosId: action.teamId, learnerLitmosId: litmosUserId, syncedAt: Date.now() })
    .onConflictDoNothing();
  return `added to team ${action.teamName ?? action.teamId}`;
}

async function runNotify(orgId: string, rule: LmsRuleRow, action: Extract<RuleAction, { type: "notify" }>, event: LmsEvent): Promise<string> {
  const body = renderTemplate(action.message ?? defaultMessage(rule.trigger), eventVars(event));
  const result = await notify({ orgId, channel: action.channel, target: action.target, subject: `LMS rule: ${rule.name}`, body, module: "lms" });
  if (result.status === "failed") throw new Error(result.error ?? "notify failed");
  return result.status;
}

async function runNotifyLearner(orgId: string, rule: LmsRuleRow, action: Extract<RuleAction, { type: "notify_learner" }>, event: LmsEvent): Promise<string> {
  const email = event.learner?.email;
  if (!email) throw new Error("event has no learner email");
  const body = renderTemplate(action.message ?? defaultMessage(rule.trigger), eventVars(event));
  const result = await notify({
    orgId,
    channel: "email",
    target: email,
    subject: `Training update: ${event.course?.name ?? "your training"}`,
    body,
    module: "lms",
  });
  if (result.status === "failed") throw new Error(result.error ?? "notify failed");
  return result.status;
}

function executeRuleAction(orgId: string, rule: LmsRuleRow, action: RuleAction, event: LmsEvent): Promise<string> {
  switch (action.type) {
    case "assign_course":
      return runAssignCourse(orgId, rule, action, event);
    case "add_to_team":
      return runAddToTeam(orgId, action, event);
    case "notify":
      return runNotify(orgId, rule, action, event);
    case "notify_learner":
      return runNotifyLearner(orgId, rule, action, event);
  }
}

// ─── the engine ───────────────────────────────────────────────────────────────

export async function fireLmsEvent(orgId: string, event: LmsEvent): Promise<{ fired: number }> {
  const rules = await db
    .select()
    .from(lmsRules)
    .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.enabled, true), eq(lmsRules.trigger, event.trigger)));
  let fired = 0;
  for (const rule of rules) {
    try {
      if (!ruleMatches(parseRuleConditions(rule.conditions), event)) continue;
      const now = Date.now();
      // The ledger insert is the idempotency gate: no row back = this (rule,
      // event) already executed on an earlier delivery — skip silently.
      const [run] = await db
        .insert(lmsRuleRuns)
        .values({
          id: randomUUID(),
          orgId,
          ruleId: rule.id,
          dedupeKey: eventDedupeKey(event),
          subject: JSON.stringify(event),
          status: "ok",
          firedAt: now,
        })
        .onConflictDoNothing({ target: [lmsRuleRuns.ruleId, lmsRuleRuns.dedupeKey] })
        .returning();
      if (!run) continue;

      const results: Array<{ type: string; ok: boolean; detail?: string }> = [];
      for (const action of parseRuleActions(rule.actions)) {
        try {
          const detail = await executeRuleAction(orgId, rule, action, event);
          results.push({ type: action.type, ok: true, detail });
        } catch (e) {
          results.push({ type: action.type, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      const status = ok === results.length ? "ok" : ok === 0 ? "failed" : "partial";
      await db.update(lmsRuleRuns).set({ results: JSON.stringify(results), status }).where(eq(lmsRuleRuns.id, run.id));
      await db
        .update(lmsRules)
        .set({ fireCount: sql`${lmsRules.fireCount} + 1`, lastFiredAt: now })
        .where(and(eq(lmsRules.orgId, orgId), eq(lmsRules.id, rule.id)));
      fired++;
    } catch {
      // One broken rule must not block the rest of the org's rules.
    }
  }
  return { fired };
}
