// Brand the tenant portal. Settings attach to the tenant ROOT team and apply
// to its whole subtree; learners in the tenant see the custom name, logo,
// accent color, and welcome message on their Learning Center home.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { getTenantSettings, normalizeHexColor, normalizeLogoUrl, saveTenantBranding, tenantRootId } from "@/lib/modules/learning-center/tenant";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, lcBtnPrimary, lcInputCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/branding?${q.toString()}`);
}

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Branding" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const rootId = tenantRootId(ctx.allTeams, team.Id);
  const rootTeam = ctx.allTeams.find((t) => t.Id === rootId);
  const settings = await getTenantSettings(rootId);
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const accent = normalizeHexColor(settings?.primaryColor) ?? "#6119e5";

  async function save(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "That tenant is outside your admin scope." });
    const logoRaw = String(formData.get("logoUrl") ?? "").trim();
    if (logoRaw && !normalizeLogoUrl(logoRaw)) back(teamId, { error: "Logo URL must be a valid https:// link." });
    const colorRaw = String(formData.get("primaryColor") ?? "").trim();
    if (colorRaw && !normalizeHexColor(colorRaw)) back(teamId, { error: "Accent color must be a hex value like #0F766E." });
    await saveTenantBranding(
      root,
      {
        portalName: String(formData.get("portalName") ?? ""),
        logoUrl: logoRaw,
        primaryColor: colorRaw,
        welcomeMessage: String(formData.get("welcomeMessage") ?? ""),
      },
      c.session.email,
    );
    await writeAudit(c.session, { action: "tenant_branding_updated", targetType: "settings", targetId: root, targetLabel: c.allTeams.find((t) => t.Id === root)?.Name, teamId: root });
    revalidatePath("/learning-center/admin/branding");
    back(teamId, { ok: "Branding saved. Learners in this tenant will see it on their next visit." });
  }

  return (
    <>
      <LcPageHeader
        title="Branding"
        subtitle={
          <>
            Portal branding for the <span className="font-semibold">{rootTeam?.Name ?? team.Name}</span> tenant (applies to it and all sub-teams).
          </>
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <LcPanel>
          <form action={save} className="space-y-4">
            <input type="hidden" name="team" value={team.Id} />
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Portal name</span>
              <input type="text" name="portalName" defaultValue={settings?.portalName ?? ""} placeholder="e.g. Meridian Health Security Training" className={`${lcInputCls} mt-1`} />
              <span className="text-xs text-lc-muted">Shown in the learner header instead of &quot;Jericho Security Learning Center&quot;.</span>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Logo URL (https)</span>
              <input type="url" name="logoUrl" defaultValue={settings?.logoUrl ?? ""} placeholder="https://…/logo.png" className={`${lcInputCls} mt-1`} />
              <span className="text-xs text-lc-muted">Displayed in the learner header. Leave blank to use the Jericho mark.</span>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Accent color</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="text" name="primaryColor" defaultValue={settings?.primaryColor ?? ""} placeholder="#6119E5" className={`${lcInputCls} !w-40`} />
                <span className="inline-block h-9 w-9 rounded-lg border border-lc-line" style={{ backgroundColor: accent }} />
              </div>
              <span className="text-xs text-lc-muted">Hex value used for the learner hero and buttons.</span>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">Welcome message</span>
              <textarea name="welcomeMessage" defaultValue={settings?.welcomeMessage ?? ""} rows={2} placeholder="Welcome to your security training." className={`${lcInputCls} mt-1`} />
            </label>
            <button type="submit" className={lcBtnPrimary}>
              Save branding
            </button>
          </form>
        </LcPanel>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted mb-2">Learner header preview</div>
          <div className="rounded-2xl border border-lc-line overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 h-14 bg-white border-b border-lc-line">
              {settings?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logoUrl} alt="" className="h-6 w-auto" />
              ) : (
                <span className="h-6 w-6 rounded" style={{ backgroundColor: accent }} />
              )}
              <span className="font-bold text-lc-ink text-sm">{settings?.portalName || "Jericho Security Learning Center"}</span>
            </div>
            <div className="p-4" style={{ backgroundColor: accent }}>
              <div className="text-white text-sm font-bold">Hero banner</div>
              <div className="text-white/85 text-xs mt-1">{settings?.welcomeMessage || "Security awareness training for your team."}</div>
            </div>
          </div>
          <div className="mt-3">
            <LcBadge tone="neutral">Tenant root: {rootTeam?.Name ?? rootId}</LcBadge>
          </div>
        </div>
      </div>
    </>
  );
}
