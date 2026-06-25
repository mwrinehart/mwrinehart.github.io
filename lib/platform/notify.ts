// Unified outbound notifier. Slack, Teams, and email were each re-implemented in
// CBM (comms.js), Horizon (email-notifications.js / sharepoint-sync.js), and Make
// — here they live once. Credentials resolve from the org's encrypted secrets,
// falling back to platform-wide env defaults. Every send is recorded in
// notification_log for audit.

import { randomUUID } from "crypto";
import { db } from "./db";
import { notificationLog } from "./db/schema";
import { getOrgSecrets } from "./secrets";
import { str } from "./env";

export type NotifyChannel = "slack" | "teams" | "email";

export interface NotifyInput {
  orgId: string | null;
  channel: NotifyChannel;
  /** Slack/Teams webhook URL, or recipient email. Falls back to org/env config. */
  target?: string;
  subject?: string;
  body: string;
  /** Module id that triggered the send (for the audit log). */
  module?: string;
}

export interface NotifyResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

async function resolveTarget(orgId: string | null, channel: NotifyChannel, explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  const secrets = orgId ? await getOrgSecrets(orgId) : {};
  if (channel === "slack") return secrets.slackWebhook ?? str("SLACK_DEFAULT_WEBHOOK");
  if (channel === "teams") return secrets.teamsWebhook ?? str("TEAMS_DEFAULT_WEBHOOK");
  return secrets.smtpUrl ?? str("SMTP_URL");
}

async function postWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  let result: NotifyResult = { status: "skipped" };
  try {
    const target = await resolveTarget(input.orgId, input.channel, input.target);
    if (!target) {
      result = { status: "skipped", error: "no target configured" };
    } else if (input.channel === "slack") {
      await postWebhook(target, { text: input.subject ? `*${input.subject}*\n${input.body}` : input.body });
      result = { status: "sent" };
    } else if (input.channel === "teams") {
      await postWebhook(target, { title: input.subject, text: input.body });
      result = { status: "sent" };
    } else {
      // Email transport (nodemailer) is added when the Compliance/CBM digests are
      // ported; until then email sends are logged and skipped, never silently lost.
      result = { status: "skipped", error: "email transport not yet wired" };
    }
  } catch (err) {
    result = { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  await db.insert(notificationLog).values({
    id: randomUUID(),
    orgId: input.orgId,
    channel: input.channel,
    target: input.target ?? null,
    module: input.module ?? null,
    subject: input.subject ?? null,
    status: result.status,
    error: result.error ?? null,
    createdAt: Date.now(),
  });

  return result;
}
