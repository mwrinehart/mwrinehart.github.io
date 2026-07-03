// LMS notification management: per-org settings (channels/cadence/learner
// emails), template overrides layered over DEFAULT_TEMPLATES, and the one
// send path every LMS notice goes through (sendLmsNotice). All transport is
// the platform notifier — this file only resolves templates and fan-out.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { notificationLog } from "@/lib/platform/db/schema";
import { notify } from "@/lib/platform/notify";
import { lmsNotificationTemplates, lmsSettings, type LmsSettingsRow } from "./schema";
import { DEFAULT_TEMPLATES, NOTIFY_CHANNELS, renderTemplate, TEMPLATE_KEYS, type NotifyChannelId, type TemplateKey } from "./types";

// ─── settings ─────────────────────────────────────────────────────────────────

export async function getLmsSettings(orgId: string): Promise<LmsSettingsRow> {
  const existing = (await db.select().from(lmsSettings).where(eq(lmsSettings.orgId, orgId)))[0];
  if (existing) return existing;
  const [created] = await db
    .insert(lmsSettings)
    .values({ orgId, reminderDays: null, channels: JSON.stringify(["email"]), notifyLearners: true, featuredCourseId: null, updatedAt: Date.now() })
    .onConflictDoNothing()
    .returning();
  // Conflict = a concurrent first read created the row; hand back theirs.
  return created ?? (await db.select().from(lmsSettings).where(eq(lmsSettings.orgId, orgId)))[0];
}

export async function updateLmsSettings(
  orgId: string,
  patch: { reminderDays?: number[]; channels?: NotifyChannelId[]; notifyLearners?: boolean; featuredCourseId?: string | null },
): Promise<void> {
  const set: Partial<typeof lmsSettings.$inferInsert> = { updatedAt: Date.now() };
  if (patch.reminderDays !== undefined) set.reminderDays = JSON.stringify(patch.reminderDays);
  if (patch.channels !== undefined) set.channels = JSON.stringify(patch.channels);
  if (patch.notifyLearners !== undefined) set.notifyLearners = patch.notifyLearners;
  if (patch.featuredCourseId !== undefined) set.featuredCourseId = patch.featuredCourseId; // null clears the hero pin
  await db
    .insert(lmsSettings)
    .values({ orgId, reminderDays: null, channels: JSON.stringify(["email"]), notifyLearners: true, featuredCourseId: null, ...set, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: lmsSettings.orgId, set });
}

// ─── templates ────────────────────────────────────────────────────────────────

export async function listTemplates(
  orgId: string,
): Promise<Array<{ key: TemplateKey; label: string; subject: string; body: string; enabled: boolean; isDefault: boolean }>> {
  const overrides = await db.select().from(lmsNotificationTemplates).where(eq(lmsNotificationTemplates.orgId, orgId));
  const byKey = new Map(overrides.map((r) => [r.key, r]));
  return TEMPLATE_KEYS.map((key) => {
    const def = DEFAULT_TEMPLATES[key];
    const row = byKey.get(key);
    return {
      key,
      label: def.label,
      subject: row?.subject ?? def.subject,
      body: row?.body ?? def.body,
      enabled: row?.enabled ?? true,
      isDefault: !row,
    };
  });
}

export async function saveTemplate(orgId: string, key: TemplateKey, patch: { subject: string; body: string; enabled: boolean }): Promise<void> {
  const now = Date.now();
  await db
    .insert(lmsNotificationTemplates)
    .values({ id: randomUUID(), orgId, key, subject: patch.subject, body: patch.body, enabled: patch.enabled, updatedAt: now })
    .onConflictDoUpdate({
      target: [lmsNotificationTemplates.orgId, lmsNotificationTemplates.key],
      set: { subject: patch.subject, body: patch.body, enabled: patch.enabled, updatedAt: now },
    });
}

export async function resetTemplate(orgId: string, key: TemplateKey): Promise<void> {
  await db.delete(lmsNotificationTemplates).where(and(eq(lmsNotificationTemplates.orgId, orgId), eq(lmsNotificationTemplates.key, key)));
}

// ─── sending ──────────────────────────────────────────────────────────────────

function parseChannels(raw: string | null): NotifyChannelId[] {
  if (!raw) return ["email"];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return ["email"];
    return arr.filter((c): c is NotifyChannelId => NOTIFY_CHANNELS.includes(c as NotifyChannelId));
  } catch {
    return ["email"];
  }
}

// Render the org's template (override else default) and fan out to the admin
// channels — org-default targets resolve from secrets inside notify() — plus a
// direct learner email when configured. Never throws: notice paths are called
// from cron/rule execution and must not abort the caller.
export async function sendLmsNotice(
  orgId: string,
  key: TemplateKey,
  vars: Record<string, string | number | null | undefined>,
  opts?: { learnerEmail?: string | null },
): Promise<void> {
  try {
    const override = (
      await db.select().from(lmsNotificationTemplates).where(and(eq(lmsNotificationTemplates.orgId, orgId), eq(lmsNotificationTemplates.key, key)))
    )[0];
    if (override?.enabled === false) return;
    const def = DEFAULT_TEMPLATES[key];
    const subject = renderTemplate(override?.subject ?? def.subject, vars);
    const body = renderTemplate(override?.body ?? def.body, vars);
    const settings = await getLmsSettings(orgId);
    for (const channel of parseChannels(settings.channels)) {
      await notify({ orgId, channel, subject, body, module: "lms" });
    }
    if (settings.notifyLearners && opts?.learnerEmail) {
      await notify({ orgId, channel: "email", target: opts.learnerEmail, subject, body, module: "lms" });
    }
  } catch {
    // notify() catches per-send; this guards settings/template resolution.
  }
}

export function listLmsNotificationLog(orgId: string, limit = 100): Promise<Array<typeof notificationLog.$inferSelect>> {
  return db
    .select()
    .from(notificationLog)
    .where(and(eq(notificationLog.orgId, orgId), eq(notificationLog.module, "lms")))
    .orderBy(desc(notificationLog.createdAt))
    .limit(limit);
}
