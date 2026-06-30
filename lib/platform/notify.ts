// Unified outbound notifier. Slack, Teams, and email were each re-implemented in
// CBM (comms.js), Horizon (email-notifications.js / sharepoint-sync.js), and Make
// — here they live once. Credentials resolve from the org's encrypted secrets,
// falling back to platform-wide env defaults. Every send is recorded in
// notification_log for audit.
//
// Channel behavior preserved from CBM:
//   - Slack via BOT TOKEN (chat.postMessage) when `slackBotToken` is set; the
//     target is a channel id. Otherwise a webhook URL is used (target = URL).
//   - Teams via incoming WEBHOOK posting a MessageCard (target = webhook URL).

import { randomUUID } from "crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "./db";
import { notificationLog } from "./db/schema";
import { getOrgSecrets, type OrgSecrets } from "./secrets";
import { str } from "./env";

const WEBHOOK_TIMEOUT_MS = 10_000;

// Escape the three characters Slack treats as control characters in message text.
// Subject/body can carry attacker-influenced content (e.g. an RSS item title that
// became a pulse/compliance alert), so without this a feed item titled
// `<https://evil|Click here>` would render as a clickable link in the org's Slack.
// https://api.slack.com/reference/surfaces/formatting#escaping
function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Cache SMTP transports by connection URL (mirrors the pg pool) so a high-volume
// digest run reuses one pooled connection instead of opening one per send.
const globalForMail = globalThis as unknown as { __jerichoMailers?: Map<string, Transporter> };
function transportFor(url: string): Transporter {
  const cache = (globalForMail.__jerichoMailers ??= new Map());
  let t = cache.get(url);
  if (!t) {
    t = nodemailer.createTransport(url);
    cache.set(url, t);
  }
  return t;
}

export type NotifyChannel = "slack" | "teams" | "email";

export interface NotifyInput {
  orgId: string | null;
  channel: NotifyChannel;
  /** Slack channel id / webhook URL, Teams webhook URL, or recipient email. */
  target?: string;
  subject?: string;
  body: string;
  /** Optional HTML body (email only). */
  html?: string;
  /** Module id that triggered the send (for the audit log). */
  module?: string;
}

export interface NotifyResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

async function sendSlack(secrets: OrgSecrets, target: string | undefined, input: NotifyInput): Promise<NotifyResult> {
  const text = input.subject ? `*${slackEscape(input.subject)}*\n${slackEscape(input.body)}` : slackEscape(input.body);
  const botToken = secrets.slackBotToken;
  if (botToken) {
    const channel = target || secrets.slackDefaultChannel;
    if (!channel) return { status: "skipped", error: "no slack channel configured" };
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return data.ok ? { status: "sent" } : { status: "failed", error: data.error || `http ${res.status}` };
  }
  const webhook = target || secrets.slackWebhook || str("SLACK_DEFAULT_WEBHOOK");
  if (!webhook) return { status: "skipped", error: "no slack target configured" };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  return res.ok ? { status: "sent" } : { status: "failed", error: `http ${res.status}` };
}

async function sendTeams(secrets: OrgSecrets, target: string | undefined, input: NotifyInput): Promise<NotifyResult> {
  const webhook = target || secrets.teamsWebhook || str("TEAMS_DEFAULT_WEBHOOK");
  if (!webhook) return { status: "skipped", error: "no teams webhook configured" };
  // MessageCard (preserved from CBM) — themeColor without leading '#'.
  const card = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: "5a1fd5",
    summary: input.subject || "Jericho notification",
    title: input.subject,
    text: input.body,
  };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  return res.ok ? { status: "sent" } : { status: "failed", error: `http ${res.status}` };
}

async function sendEmail(secrets: OrgSecrets, to: string | undefined, input: NotifyInput): Promise<NotifyResult> {
  if (!to) return { status: "skipped", error: "no recipient" };
  const url = secrets.smtpUrl || str("SMTP_URL");
  if (!url) return { status: "skipped", error: "SMTP not configured" };
  const from = secrets.smtpFrom || str("SMTP_FROM") || "no-reply@jerichosecurity.com";
  const transport = transportFor(url);
  // A URL-string transport sets no socket timeout; race the send so a hung mail
  // server can't stall the digest/cron tick indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SMTP send timed out")), WEBHOOK_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      transport.sendMail({ from, to, subject: input.subject || "Jericho notification", text: input.body, html: input.html }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
  return { status: "sent" };
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  let result: NotifyResult = { status: "skipped" };
  try {
    const secrets = input.orgId ? await getOrgSecrets(input.orgId) : {};
    if (input.channel === "slack") {
      result = await sendSlack(secrets, input.target, input);
    } else if (input.channel === "teams") {
      result = await sendTeams(secrets, input.target, input);
    } else {
      result = await sendEmail(secrets, input.target, input);
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
