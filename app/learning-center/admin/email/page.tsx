// Custom SMTP per tenant — so each tenant's notifications go out from their own
// email address. The connection string (which carries the password) is stored
// AES-256-GCM encrypted and is write-only in the UI; only the "from" address is
// shown back. A test send confirms the configuration end to end.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, selectedTeam } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { decryptTenantSmtp, getTenantSettings, saveTenantSmtp, tenantRootId } from "@/lib/modules/learning-center/tenant";
import { notify } from "@/lib/platform/notify";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, lcBtnDanger, lcBtnPrimary, lcBtnSecondary, lcInputCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/email?${q.toString()}`);
}

export default async function EmailPage({
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
        <LcPageHeader title="Email (SMTP)" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const rootId = tenantRootId(ctx.allTeams, team.Id);
  const rootTeam = ctx.allTeams.find((t) => t.Id === rootId);
  const settings = await getTenantSettings(rootId);
  const configured = !!settings?.smtpEncrypted;
  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  async function save(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "That tenant is outside your admin scope." });
    const url = String(formData.get("smtpUrl") ?? "").trim();
    const from = String(formData.get("smtpFrom") ?? "").trim();
    const fromName = String(formData.get("smtpFromName") ?? "").trim();
    if (!url) back(teamId, { error: "Enter the SMTP connection URL." });
    try {
      await saveTenantSmtp(root, { url, from, fromName }, c.session.email);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Could not save SMTP settings." });
    }
    await writeAudit(c.session, { action: "tenant_smtp_configured", targetType: "settings", targetId: root, targetLabel: from || rootTeam?.Name, teamId: root });
    revalidatePath("/learning-center/admin/email");
    back(teamId, { ok: "Custom SMTP saved. Notifications for this tenant will send from this server." });
  }

  async function clear(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "That tenant is outside your admin scope." });
    await saveTenantSmtp(root, null, c.session.email);
    await writeAudit(c.session, { action: "tenant_smtp_cleared", targetType: "settings", targetId: root, teamId: root });
    revalidatePath("/learning-center/admin/email");
    back(teamId, { ok: "Custom SMTP removed — this tenant falls back to the platform mailer." });
  }

  async function sendTest(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    const root = tenantRootId(c.allTeams, teamId);
    if (!c.scopeIds.includes(root)) back(teamId, { error: "That tenant is outside your admin scope." });
    const to = String(formData.get("testTo") ?? "").trim() || c.session.email;
    const row = await getTenantSettings(root);
    const smtp = decryptTenantSmtp(row);
    if (!smtp) back(teamId, { error: "Configure and save SMTP before sending a test." });
    const result = await notify({
      orgId: null,
      channel: "email",
      target: to,
      subject: "Learning Center SMTP test",
      body: `This is a test email from your ${rootTeam?.Name ?? "tenant"} Learning Center SMTP configuration. If you received it, custom email is working.`,
      module: "learning-center",
      smtp,
    });
    await writeAudit(c.session, { action: "tenant_smtp_test", targetType: "settings", targetId: root, targetLabel: to, teamId: root, detail: `Status ${result.status}` });
    back(teamId, result.status === "sent" ? { ok: `Test email sent to ${to}.` } : { error: `Test ${result.status}: ${result.error ?? "check the SMTP URL and credentials."}` });
  }

  return (
    <>
      <LcPageHeader
        title="Email (SMTP)"
        subtitle={
          <>
            Send this tenant&apos;s notifications from your own email server. Applies to the <span className="font-semibold">{rootTeam?.Name ?? team.Name}</span>{" "}tenant.
          </>
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-2">
        <LcPanel>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lc-ink">SMTP connection</h3>
            {configured ? <LcBadge tone="purple">Configured</LcBadge> : <LcBadge tone="neutral">Using platform mailer</LcBadge>}
          </div>
          {configured && settings?.smtpFromHint && <p className="text-xs text-lc-muted mb-3">Currently sending from <span className="font-semibold">{settings.smtpFromHint}</span>.</p>}
          <form action={save} className="space-y-3">
            <input type="hidden" name="team" value={team.Id} />
            <label className="block text-sm">
              <span className="font-semibold text-lc-ink">SMTP URL</span>
              <input type="password" name="smtpUrl" placeholder={configured ? "•••••• (enter to replace)" : "smtps://user:pass@smtp.host:465"} required className={`${lcInputCls} mt-1 font-mono text-xs`} autoComplete="off" />
              <span className="text-xs text-lc-muted">Nodemailer connection string. Stored encrypted; never shown back.</span>
            </label>
            <div className="flex gap-2">
              <label className="block text-sm flex-1">
                <span className="font-semibold text-lc-ink">From address</span>
                <input type="email" name="smtpFrom" defaultValue={settings?.smtpFromHint ?? ""} placeholder="training@meridianhealth.com" className={`${lcInputCls} mt-1`} />
              </label>
              <label className="block text-sm flex-1">
                <span className="font-semibold text-lc-ink">From name</span>
                <input type="text" name="smtpFromName" placeholder="Meridian Training" className={`${lcInputCls} mt-1`} />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" className={lcBtnPrimary}>
                Save SMTP
              </button>
            </div>
          </form>
          {configured && (
            <form action={clear} className="mt-3">
              <input type="hidden" name="team" value={team.Id} />
              <button type="submit" className={lcBtnDanger}>
                Remove custom SMTP
              </button>
            </form>
          )}
        </LcPanel>

        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-1">Send a test</h3>
          <p className="text-xs text-lc-muted mb-3">Verifies the saved configuration by sending a real email through your server.</p>
          <form action={sendTest} className="space-y-3">
            <input type="hidden" name="team" value={team.Id} />
            <input type="email" name="testTo" placeholder={ctx.session.email} className={lcInputCls} />
            <button type="submit" className={lcBtnSecondary} disabled={!configured}>
              Send test email
            </button>
            {!configured && <p className="text-xs text-lc-muted">Save an SMTP configuration first.</p>}
          </form>
          <div className="mt-5 rounded-xl bg-lc-tint p-3 text-xs text-lc-muted leading-relaxed">
            When configured, every notification for this tenant — welcome links, assignment emails, due-date and compliance reminders, custom messages — is
            sent through this server with your from address. Without it, the platform default mailer is used.
          </div>
        </LcPanel>
      </div>
    </>
  );
}
