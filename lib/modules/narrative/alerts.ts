// Alerting for the Narrative module: recompute narrative stats from mentions,
// re-score, and raise alerts when a narrative crosses the policy in scoring.ts.
// In-app alert rows are the primary record; channel fan-out (Slack/Teams/email)
// goes through per-org routes and the platform notifier, under a per-run budget
// so a backlog can't storm channels.

import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { severityAtLeast, severityRank, type Severity } from "@/lib/platform/feeds";
import { notify } from "@/lib/platform/notify";
import { logAudit } from "./audit";
import { alertDecision, scoreNarrative, severityForScore, type Verdict } from "./scoring";
import { narrativeAlerts, narrativeMentions, narrativeRoutes, narratives } from "./schema";

const DAY = 86_400_000;

// A narrative stops being "emerging" once this many mentions cluster on it.
const ACTIVE_MENTION_THRESHOLD = 3;

// Channel-notification cap per refresh run (in-app alert rows are not capped).
const MAX_CHANNEL_ALERTS_PER_RUN = 10;

// ─── alert queue ──────────────────────────────────────────────────────────────

export function listAlerts(orgId: string, limit = 100) {
  // Open alerts sort into the window regardless of age so an old open alert
  // can't fall out of the queue while the dashboard still counts it.
  return db
    .select()
    .from(narrativeAlerts)
    .where(eq(narrativeAlerts.orgId, orgId))
    .orderBy(sql`CASE ${narrativeAlerts.status} WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END`, desc(narrativeAlerts.createdAt))
    .limit(limit);
}

export async function setAlertStatus(orgId: string, userId: string, id: string, status: "acknowledged" | "resolved"): Promise<void> {
  // Forward-only transitions, enforced atomically: open → acknowledged →
  // resolved (resolve may skip acknowledge). A resolved alert never reopens.
  const allowedFrom = status === "acknowledged" ? ["open"] : ["open", "acknowledged"];
  const updated = await db
    .update(narrativeAlerts)
    .set({ status, acknowledgedByUserId: userId, acknowledgedAt: Date.now() })
    .where(and(eq(narrativeAlerts.orgId, orgId), eq(narrativeAlerts.id, id), inArray(narrativeAlerts.status, allowedFrom)))
    .returning({ narrativeId: narrativeAlerts.narrativeId });
  if (updated.length) await logAudit(orgId, updated[0].narrativeId, userId, `alert.${status}`);
}

// ─── channel routes ───────────────────────────────────────────────────────────

export function listRoutes(orgId: string) {
  return db.select().from(narrativeRoutes).where(eq(narrativeRoutes.orgId, orgId)).orderBy(desc(narrativeRoutes.createdAt));
}

export async function addRoute(
  orgId: string,
  input: { name: string; severityMin: Severity; channelProvider: "slack" | "teams" | "email"; channelTarget: string },
): Promise<void> {
  await db.insert(narrativeRoutes).values({
    id: randomUUID(),
    orgId,
    name: input.name.trim() || "Route",
    severityMin: input.severityMin,
    channelProvider: input.channelProvider,
    channelTarget: input.channelTarget.trim(),
    enabled: true,
    createdAt: Date.now(),
  });
}

export async function deleteRoute(orgId: string, id: string): Promise<void> {
  await db.delete(narrativeRoutes).where(and(eq(narrativeRoutes.orgId, orgId), eq(narrativeRoutes.id, id)));
}

export async function setRouteEnabled(orgId: string, id: string, enabled: boolean): Promise<void> {
  await db.update(narrativeRoutes).set({ enabled }).where(and(eq(narrativeRoutes.orgId, orgId), eq(narrativeRoutes.id, id)));
}

// ─── recompute + alert pass ───────────────────────────────────────────────────

export interface RefreshResult {
  refreshed: number;
  alerts: number;
}

// Recompute the given narratives' aggregates from their mentions (count, reach,
// velocity, last-seen), re-score them, promote emerging → active, and raise
// alerts on escalation. Called after every scan and after every AI/analyst
// verdict change — this is the single place alert policy is applied.
export async function refreshNarratives(orgId: string, narrativeIds: string[]): Promise<RefreshResult> {
  const ids = [...new Set(narrativeIds)];
  const result: RefreshResult = { refreshed: 0, alerts: 0 };
  if (!ids.length) return result;

  const now = Date.now();
  const rows = await db
    .select()
    .from(narratives)
    .where(and(eq(narratives.orgId, orgId), inArray(narratives.id, ids)));

  // Aggregate mention stats in two grouped queries instead of per-narrative
  // round trips. count(*)/sum() come back as strings from pg — Number() them.
  const totals = await db
    .select({
      narrativeId: narrativeMentions.narrativeId,
      n: sql<number>`count(*)`,
      reach: sql<number>`coalesce(sum(${narrativeMentions.reach}), 0)`,
      lastSeen: sql<number>`max(${narrativeMentions.fetchedAt})`,
    })
    .from(narrativeMentions)
    .where(and(eq(narrativeMentions.orgId, orgId), inArray(narrativeMentions.narrativeId, ids)))
    .groupBy(narrativeMentions.narrativeId);
  const recent = await db
    .select({ narrativeId: narrativeMentions.narrativeId, n: sql<number>`count(*)` })
    .from(narrativeMentions)
    .where(and(eq(narrativeMentions.orgId, orgId), inArray(narrativeMentions.narrativeId, ids), gte(narrativeMentions.fetchedAt, now - DAY)))
    .groupBy(narrativeMentions.narrativeId);
  const totalsById = new Map(totals.map((t) => [t.narrativeId, t]));
  const recentById = new Map(recent.map((r) => [r.narrativeId, Number(r.n)]));

  const routes = (await listRoutes(orgId)).filter((r) => r.enabled);
  const budget = { remaining: MAX_CHANNEL_ALERTS_PER_RUN };
  let budgetExhausted = false;

  // Ranks the LIVE alerted_severity column, mirroring severityRank() (null → -1),
  // so the high-water-mark claim below is race-free against concurrent runs.
  const liveAlertedRank = sql<number>`CASE coalesce(${narratives.alertedSeverity}, '') WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 WHEN 'low' THEN 0 ELSE -1 END`;

  for (const row of rows) {
    const t = totalsById.get(row.id);
    const mentionCount = Number(t?.n ?? 0);
    const totalReach = Number(t?.reach ?? 0);
    const lastSeenAt = t?.lastSeen != null ? Number(t.lastSeen) : row.lastSeenAt;
    const velocity = recentById.get(row.id) ?? 0;
    const signals = {
      verdict: row.verdict as Verdict,
      verdictConfidence: row.verdictConfidence,
      mentionCount,
      totalReach,
      velocity,
      lastSeenAt,
    };
    const threatScore = scoreNarrative(signals, now);

    // Stats never touch status — a concurrent analyst dismissal must not be
    // reverted by this run's stale snapshot. Promotion runs against live status.
    await db
      .update(narratives)
      .set({ mentionCount, totalReach, velocity, lastSeenAt, threatScore, updatedAt: now })
      .where(and(eq(narratives.orgId, orgId), eq(narratives.id, row.id)));
    if (mentionCount >= ACTIVE_MENTION_THRESHOLD) {
      await db
        .update(narratives)
        .set({ status: "active" })
        .where(and(eq(narratives.orgId, orgId), eq(narratives.id, row.id), eq(narratives.status, "emerging")));
    }
    result.refreshed++;

    // Dismissed/countered narratives are still tracked but never re-alert.
    // (Cheap pre-filter on the snapshot; the claim below re-checks live state.)
    if (row.status === "dismissed" || row.status === "countered") continue;

    const decision = alertDecision(signals, threatScore, (row.alertedSeverity as Severity | null) ?? null);
    if (!decision.alert) continue;

    // Claim the high-water mark atomically against LIVE state: exactly one of
    // any concurrent refresh runs wins the escalation, and a narrative the
    // analyst dismissed while this run was in flight never alerts.
    const claimed = await db
      .update(narratives)
      .set({ alertedSeverity: decision.severity })
      .where(
        and(
          eq(narratives.orgId, orgId),
          eq(narratives.id, row.id),
          notInArray(narratives.status, ["dismissed", "countered"]),
          sql`${liveAlertedRank} < ${severityRank(decision.severity)}`,
        ),
      )
      .returning({ id: narratives.id });
    if (!claimed.length) continue;

    const title =
      row.verdict === "false" || row.verdict === "misleading"
        ? `False narrative spreading: ${row.title}`
        : `Fast-spreading unverified narrative: ${row.title}`;
    const body =
      `Verdict: ${row.verdict} (${row.verdictConfidence}% confidence). ` +
      `${mentionCount} mentions, reach ~${totalReach}, ${velocity} in the last 24h. Threat score ${threatScore}/100.` +
      (row.claim ? `\nClaim: ${row.claim}` : "");

    await db.insert(narrativeAlerts).values({
      id: randomUUID(),
      orgId,
      narrativeId: row.id,
      severity: decision.severity,
      title,
      body,
      status: "open",
      createdAt: now,
    });
    result.alerts++;
    await logAudit(orgId, row.id, null, `alert.raised.${decision.severity}`, row.title.slice(0, 60));

    // Channel fan-out is best-effort on top of the in-app alert. Unlike
    // Compliance (which defers its high-water stamp to retry dropped sends),
    // the mark is already claimed above for exactly-once alerting — so a
    // budget-capped send is audited instead of silently lost.
    for (const route of routes) {
      if (budget.remaining <= 0) {
        budgetExhausted = true;
        break;
      }
      if (!severityAtLeast(decision.severity, route.severityMin as Severity)) continue;
      const res = await notify({
        orgId,
        channel: route.channelProvider as "slack" | "teams" | "email",
        target: route.channelTarget,
        subject: `[${decision.severity.toUpperCase()}] ${title}`,
        body,
        module: "narrative",
      });
      if (res.status === "sent") {
        budget.remaining--;
        // SQL increment avoids stale-read lost updates across concurrent runs.
        await db
          .update(narrativeRoutes)
          .set({ sentCount: sql`${narrativeRoutes.sentCount} + 1`, lastSentAt: Date.now() })
          .where(eq(narrativeRoutes.id, route.id));
      }
    }
  }

  if (budgetExhausted) {
    await logAudit(orgId, null, null, "alert.channel_budget_exhausted", `capped at ${MAX_CHANNEL_ALERTS_PER_RUN} channel sends this run`);
  }

  return result;
}

export { severityForScore };
