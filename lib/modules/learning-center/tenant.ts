// Tenant model. A "tenant" is a top-level Litmos team; all tenant-level
// configuration (portal branding, custom SMTP, gamification, certificates,
// API keys) attaches to that root team and applies to its whole subtree.
// None of this exists in the Litmos API — the dashboard owns it.

import { eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { decryptJson, encryptJson } from "@/lib/platform/secrets";
import { lcTenantSettings, type LcTenantSettingsRow } from "./schema";
import type { LitmosTeam } from "./types";

// Walk ParentTeamId links to the top-level team. Cycle-safe; unknown ids
// return themselves so callers degrade gracefully.
export function tenantRootId(teams: LitmosTeam[], teamId: string): string {
  const byId = new Map(teams.map((t) => [t.Id, t]));
  let current = byId.get(teamId);
  if (!current) return teamId;
  const seen = new Set<string>([current.Id]);
  while (current.ParentTeamId) {
    const parent = byId.get(current.ParentTeamId);
    if (!parent || seen.has(parent.Id)) break;
    seen.add(parent.Id);
    current = parent;
  }
  return current.Id;
}

export interface TenantSmtp {
  url: string;
  from?: string;
  fromName?: string;
}

export interface TenantBranding {
  portalName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  welcomeMessage: string | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return HEX_COLOR.test(v) ? v.toLowerCase() : null;
}

// Logo URLs must be https (rendered as <img src> on the learner portal).
export function normalizeLogoUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getTenantSettings(tenantRootTeamId: string): Promise<LcTenantSettingsRow | null> {
  const rows = await db.select().from(lcTenantSettings).where(eq(lcTenantSettings.teamId, tenantRootTeamId)).limit(1);
  return rows[0] ?? null;
}

async function upsertTenantSettings(tenantRootTeamId: string, patch: Partial<typeof lcTenantSettings.$inferInsert>, updatedBy: string): Promise<void> {
  const now = Date.now();
  const existing = await getTenantSettings(tenantRootTeamId);
  if (existing) {
    await db
      .update(lcTenantSettings)
      .set({ ...patch, updatedBy, updatedAt: now })
      .where(eq(lcTenantSettings.teamId, tenantRootTeamId));
  } else {
    await db.insert(lcTenantSettings).values({
      teamId: tenantRootTeamId,
      ...patch,
      updatedBy,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function saveTenantBranding(tenantRootTeamId: string, branding: TenantBranding, updatedBy: string): Promise<void> {
  await upsertTenantSettings(
    tenantRootTeamId,
    {
      portalName: branding.portalName?.trim() || null,
      logoUrl: normalizeLogoUrl(branding.logoUrl),
      primaryColor: normalizeHexColor(branding.primaryColor),
      welcomeMessage: branding.welcomeMessage?.trim() || null,
    },
    updatedBy,
  );
}

export async function saveTenantGamification(
  tenantRootTeamId: string,
  config: { gamificationEnabled: boolean; showLeaderboard: boolean; pointsPerCompletion: number },
  updatedBy: string,
): Promise<void> {
  await upsertTenantSettings(
    tenantRootTeamId,
    {
      gamificationEnabled: config.gamificationEnabled,
      showLeaderboard: config.showLeaderboard,
      pointsPerCompletion: Math.max(0, Math.min(10_000, Math.round(config.pointsPerCompletion || 0))),
    },
    updatedBy,
  );
}

// SMTP credentials are AES-256-GCM encrypted at rest via the platform master
// key; the URL (which carries the password) is write-only in the UI.
export async function saveTenantSmtp(tenantRootTeamId: string, smtp: TenantSmtp | null, updatedBy: string): Promise<void> {
  if (smtp === null) {
    await upsertTenantSettings(tenantRootTeamId, { smtpEncrypted: null, smtpFromHint: null }, updatedBy);
    return;
  }
  const url = smtp.url.trim();
  if (!/^smtps?:\/\//i.test(url)) throw new Error("SMTP URL must start with smtp:// or smtps://");
  await upsertTenantSettings(
    tenantRootTeamId,
    {
      smtpEncrypted: encryptJson({ url, from: smtp.from?.trim() || undefined, fromName: smtp.fromName?.trim() || undefined }),
      smtpFromHint: smtp.from?.trim() || null,
    },
    updatedBy,
  );
}

export function decryptTenantSmtp(row: LcTenantSettingsRow | null): TenantSmtp | null {
  if (!row?.smtpEncrypted) return null;
  const parsed = decryptJson<Partial<TenantSmtp>>(row.smtpEncrypted);
  if (!parsed?.url || typeof parsed.url !== "string") return null;
  return { url: parsed.url, from: typeof parsed.from === "string" ? parsed.from : undefined, fromName: typeof parsed.fromName === "string" ? parsed.fromName : undefined };
}

// The branding a given team's members see: their tenant root's settings.
export async function brandingForTeam(teams: LitmosTeam[], teamId: string): Promise<{ rootId: string; settings: LcTenantSettingsRow | null }> {
  const rootId = tenantRootId(teams, teamId);
  return { rootId, settings: await getTenantSettings(rootId) };
}

// The branding a learner sees: the first of their teams (by tenant root) that
// has settings configured; falls back to plain Jericho branding.
export async function brandingForUserTeams(teams: LitmosTeam[], userTeams: LitmosTeam[]): Promise<LcTenantSettingsRow | null> {
  const roots = [...new Set(userTeams.map((t) => tenantRootId(teams, t.Id)))];
  for (const rootId of roots) {
    const settings = await getTenantSettings(rootId);
    if (settings && (settings.portalName || settings.logoUrl || settings.primaryColor || settings.welcomeMessage)) return settings;
  }
  // Even without branding, the first root's settings still matter (gamification flags).
  return roots.length ? await getTenantSettings(roots[0]) : null;
}
