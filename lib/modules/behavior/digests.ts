// Scheduled pulse digests (ported from CBM pulseNotifications.js digest logic).
// The pulse-digests cron job calls tickDigests() hourly; each due digest emails
// its recipients a summary of recent findings via the unified notifier.

import { randomUUID } from "crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { notify } from "@/lib/platform/notify";
import { severityAtLeast, type Severity } from "@/lib/platform/feeds";
import { pulseDigests, pulseFindings } from "./schema";

const DAY_MS = 86_400_000;
const DEBOUNCE_MS = 50 * 60 * 1000;

export function listDigests(orgId: string) {
  return db.select().from(pulseDigests).where(eq(pulseDigests.orgId, orgId)).orderBy(desc(pulseDigests.createdAt));
}

export async function createDigest(
  orgId: string,
  input: { name: string; frequency: "daily" | "weekly"; dayOfWeek?: number; hour: number; recipients: string; severityMin?: Severity; categories?: string },
): Promise<void> {
  await db.insert(pulseDigests).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Digest",
    frequency: input.frequency,
    dayOfWeek: input.frequency === "weekly" ? input.dayOfWeek ?? 1 : null,
    hour: Math.max(0, Math.min(23, input.hour)),
    recipients: input.recipients,
    severityMin: input.severityMin ?? "medium",
    categories: input.categories ?? null,
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteDigest(orgId: string, id: string): Promise<void> {
  await db.delete(pulseDigests).where(and(eq(pulseDigests.orgId, orgId), eq(pulseDigests.id, id)));
}

async function findingsForDigest(orgId: string, severityMin: Severity, categories: string | null, sinceMs: number) {
  const rows = await db
    .select()
    .from(pulseFindings)
    .where(and(eq(pulseFindings.orgId, orgId), gte(pulseFindings.scannedAt, sinceMs)));
  const cats = categories ? categories.split(",").map((c) => c.trim().toLowerCase()) : null;
  return rows
    .filter((f) => severityAtLeast(f.severity as Severity, severityMin))
    .filter((f) => !cats || (f.category && cats.includes(f.category.toLowerCase())))
    .slice(0, 100);
}

function renderDigest(name: string, findings: Awaited<ReturnType<typeof findingsForDigest>>): { html: string; text: string } {
  const lines = findings.map((f) => `• [${f.severity.toUpperCase()}] ${f.title} — ${f.link ?? ""}`);
  const items = findings
    .map((f) => `<li><strong>[${f.severity.toUpperCase()}]</strong> <a href="${f.link ?? "#"}">${f.title}</a></li>`)
    .join("");
  return {
    text: `${name}\n\n${lines.join("\n")}`,
    html: `<h2>${name}</h2><p>${findings.length} finding(s)</p><ul>${items}</ul>`,
  };
}

export async function sendDigest(digest: typeof pulseDigests.$inferSelect): Promise<"sent" | "failed" | "skipped"> {
  const window = digest.frequency === "weekly" ? 7 * DAY_MS : DAY_MS;
  const findings = await findingsForDigest(digest.orgId, digest.severityMin as Severity, digest.categories, Date.now() - window);

  let status: "sent" | "failed" | "skipped";
  if (findings.length === 0) {
    status = "skipped";
  } else {
    const { html, text } = renderDigest(digest.name, findings);
    const res = await notify({
      orgId: digest.orgId,
      channel: "email",
      target: digest.recipients,
      subject: `${digest.name} — ${findings.length} finding(s)`,
      body: text,
      html,
      module: "behavior",
    });
    status = res.status === "sent" ? "sent" : res.status === "failed" ? "failed" : "skipped";
  }

  await db.update(pulseDigests).set({ lastRunAt: Date.now(), lastStatus: status }).where(eq(pulseDigests.id, digest.id));
  return status;
}

// Global hourly tick: send every enabled digest whose schedule matches this hour
// (UTC) and that hasn't run in the last ~hour.
export async function tickDigests(): Promise<{ checked: number; sent: number; due: number }> {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  const nowMs = now.getTime();

  const all = await db.select().from(pulseDigests).where(eq(pulseDigests.enabled, true));
  let due = 0;
  let sent = 0;
  for (const d of all) {
    const matches = d.hour === hour && (d.frequency === "daily" || (d.frequency === "weekly" && d.dayOfWeek === day));
    const debounced = !d.lastRunAt || nowMs - d.lastRunAt > DEBOUNCE_MS;
    if (!matches || !debounced) continue;
    due++;
    const status = await sendDigest(d);
    if (status === "sent") sent++;
  }
  return { checked: all.length, due, sent };
}
