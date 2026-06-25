// Nudge delivery (ported from CBM nudgeSystem.js). A nudge config is sent across
// its configured channels: `device` queues a per-person event (rendered by an
// end-user widget — that widget is a scheduling/embed follow-up), while `slack`
// and `teams` send immediately through the unified notifier. Every send/queue is
// recorded in nudge_events.
//
// Note: per-nudge target selection (CBM's target_user_ids) is simplified here —
// device nudges queue for all monitored people in the org.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { notify } from "@/lib/platform/notify";
import { behaviorPeople, nudgeConfigs, nudgeEvents } from "./schema";

const ALLOWED_CHANNELS = new Set(["device", "slack", "teams"]);

export function listNudgeConfigs(orgId: string) {
  return db.select().from(nudgeConfigs).where(eq(nudgeConfigs.orgId, orgId)).orderBy(desc(nudgeConfigs.createdAt));
}

export function listNudgeEvents(orgId: string, limit = 50) {
  return db
    .select()
    .from(nudgeEvents)
    .where(eq(nudgeEvents.orgId, orgId))
    .orderBy(desc(nudgeEvents.createdAt))
    .limit(limit);
}

function normalizeChannels(raw: string): string[] {
  return raw
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => ALLOWED_CHANNELS.has(c));
}

export async function createNudgeConfig(
  orgId: string,
  input: {
    title: string;
    message: string;
    trigger?: string;
    deliveryChannels?: string;
    slackChannel?: string;
    teamsWebhookId?: string;
    icon?: string;
    delayMs?: number;
  },
): Promise<void> {
  await db.insert(nudgeConfigs).values({
    id: randomUUID(),
    orgId,
    title: input.title.trim(),
    message: input.message.trim(),
    trigger: input.trigger ?? "manual",
    deliveryChannels: normalizeChannels(input.deliveryChannels ?? "device").join(",") || "device",
    slackChannel: input.slackChannel ?? null,
    teamsWebhookId: input.teamsWebhookId ?? null,
    icon: input.icon ?? null,
    delayMs: input.delayMs && input.delayMs > 0 ? input.delayMs : 5000,
    active: true,
    createdAt: Date.now(),
  });
}

// Active device-channel nudges served (read-only, deduped client-side) by the
// public embeddable widget.
export async function listActiveDeviceNudges(
  orgId: string,
): Promise<Array<{ id: string; title: string; message: string; icon: string; delayMs: number }>> {
  const rows = await db.select().from(nudgeConfigs).where(and(eq(nudgeConfigs.orgId, orgId), eq(nudgeConfigs.active, true)));
  return rows
    .filter((n) => n.deliveryChannels.split(",").map((s) => s.trim()).includes("device"))
    .map((n) => ({ id: n.id, title: n.title ?? "", message: n.message ?? "", icon: n.icon ?? "ℹ️", delayMs: n.delayMs }));
}

export interface SendNudgeResult {
  device: number;
  slack: "sent" | "failed" | "skipped" | null;
  teams: "sent" | "failed" | "skipped" | null;
}

export async function sendNudge(orgId: string, nudgeId: string): Promise<SendNudgeResult> {
  const rows = await db
    .select()
    .from(nudgeConfigs)
    .where(and(eq(nudgeConfigs.orgId, orgId), eq(nudgeConfigs.id, nudgeId)));
  const cfg = rows[0];
  if (!cfg) throw new Error("Nudge not found");

  const channels = normalizeChannels(cfg.deliveryChannels);
  const result: SendNudgeResult = { device: 0, slack: null, teams: null };
  const now = Date.now();

  if (channels.includes("device")) {
    const people = await db
      .select({ id: behaviorPeople.id })
      .from(behaviorPeople)
      .where(eq(behaviorPeople.orgId, orgId));
    for (const p of people) {
      await db.insert(nudgeEvents).values({
        id: randomUUID(),
        orgId,
        personId: p.id,
        nudgeId,
        action: "queued",
        deliveryChannel: "device",
        status: "pending",
        title: cfg.title,
        message: cfg.message,
        createdAt: now,
      });
    }
    result.device = people.length;
  }

  for (const channel of ["slack", "teams"] as const) {
    if (!channels.includes(channel)) continue;
    const target = channel === "slack" ? cfg.slackChannel ?? undefined : cfg.teamsWebhookId ?? undefined;
    const res = await notify({
      orgId,
      channel,
      target,
      subject: cfg.title ?? undefined,
      body: cfg.message ?? "",
      module: "behavior",
    });
    result[channel] = res.status;
    await db.insert(nudgeEvents).values({
      id: randomUUID(),
      orgId,
      personId: null,
      nudgeId,
      action: res.status === "sent" ? "sent" : "failed",
      deliveryChannel: channel,
      status: res.status,
      title: cfg.title,
      message: cfg.message,
      createdAt: now,
    });
  }

  return result;
}
