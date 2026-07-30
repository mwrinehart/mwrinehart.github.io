// Manage notifications for the team's brand. Litmos email templates are
// account-owner-only AND have no API, so the dashboard owns its own template
// layer, sent via SMTP. The brand rule: teams on the Jericho/default brands
// use centrally managed messaging (read-only here); teams on a custom brand
// manage their own templates. Manual trigger/resend lives here too: resend a
// sign-in link (rebuilt from the Litmos LoginKey) or send a custom message.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_TYPES,
  deleteTemplate,
  getTeamBrand,
  listSends,
  listTemplates,
  saveTemplate,
  sendNotification,
  type TemplateType,
} from "@/lib/modules/learning-center/notifications";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcBtnSecondary, lcInputCls, lcSelectCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/notifications?${q.toString()}`);
}

function isTemplateType(v: string): v is TemplateType {
  return TEMPLATE_TYPES.some((t) => t.type === v);
}

function ago(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; edit?: string; course?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Notifications" />
        <LcEmpty title="No teams in your scope" />
      </>
    );
  }

  const [brand, allTemplates, sends, members, teamCourses] = await Promise.all([
    getTeamBrand(ctx.source, team.Id),
    listTemplates(team.Id),
    listSends(ctx.isOwner ? null : ctx.scopeIds, 30),
    ctx.source.listTeamUsers(team.Id),
    ctx.source.listTeamCourses(team.Id),
  ]);
  // Course scope: "" = team defaults; a course id = per-course overrides.
  const courseScope = params.course && teamCourses.some((c) => c.Id === params.course) ? params.course : "";
  const templates = allTemplates.filter((t) => (t.courseId ?? "") === courseScope);
  const scopeCourse = courseScope ? teamCourses.find((c) => c.Id === courseScope) : null;

  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));
  const editType = params.edit && isTemplateType(params.edit) ? params.edit : null;
  const editing = editType ? (templates.find((t) => t.type === editType) ?? null) : null;
  const editDefaults = editType ? (editing ?? { name: DEFAULT_TEMPLATES[editType].name, subject: DEFAULT_TEMPLATES[editType].subject, body: DEFAULT_TEMPLATES[editType].body, active: true }) : null;

  async function save(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const brandInfo = await getTeamBrand(c.source, teamId);
    if (!brandInfo.manageable) back(teamId, { error: "This team uses a Jericho-managed brand — its notification templates are managed centrally." });
    const type = String(formData.get("type") ?? "");
    if (!isTemplateType(type)) back(teamId, { error: "Invalid template type." });
    const courseId = String(formData.get("courseId") ?? "") || null;
    const existing = (await listTemplates(teamId, courseId)).find((t) => t.type === type);
    const name = String(formData.get("name") ?? "").trim();
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!name || !subject || !body) back(teamId, { error: "Name, subject, and body are all required." });
    await saveTemplate({
      id: existing?.id,
      teamId,
      brand: brandInfo.brand,
      type,
      courseId,
      name,
      subject,
      body,
      active: formData.get("active") === "on",
      updatedBy: c.session.email,
    });
    await writeAudit(c.session, { action: existing ? "template_updated" : "template_created", targetType: "template", targetLabel: `${type}: ${name}${courseId ? " (course)" : ""}`, teamId });
    revalidatePath("/learning-center/admin/notifications");
    back(teamId, { ok: `Template "${name}" saved.`, ...(courseId ? { course: courseId } : {}) });
  }

  async function removeTemplate(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const brandInfo = await getTeamBrand(c.source, teamId);
    if (!brandInfo.manageable) back(teamId, { error: "This team's templates are managed centrally." });
    const id = String(formData.get("id") ?? "");
    const label = String(formData.get("label") ?? id);
    await deleteTemplate(teamId, id);
    await writeAudit(c.session, { action: "template_deleted", targetType: "template", targetLabel: label, teamId });
    revalidatePath("/learning-center/admin/notifications");
    back(teamId, { ok: `Template deleted — sends fall back to the built-in default.` });
  }

  async function resendLogin(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const userId = String(formData.get("userId") ?? "");
    const teamMembers = await c.source.listTeamUsers(teamId);
    const user = teamMembers.find((u) => u.Id === userId);
    if (!user) back(teamId, { error: "Pick a team member." });
    const outcome = await sendNotification({
      source: c.source,
      teamId,
      teamName: teamName(c, teamId),
      type: "welcome",
      recipients: [{ user }],
      sentBy: c.session.email,
    });
    await writeAudit(c.session, { action: "login_link_resent", targetType: "user", targetId: userId, targetLabel: user.Email, teamId, detail: `Status ${outcome.status}` });
    back(teamId, outcome.sent > 0 ? { ok: `Sign-in link sent to ${user.Email}.` } : { error: `Send ${outcome.status} — SMTP may not be configured (attempt logged).` });
  }

  async function sendCustom(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const audience = String(formData.get("audience") ?? "team");
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    if (!subject || !body) back(teamId, { error: "Subject and message are required." });
    const teamMembers = await c.source.listTeamUsers(teamId);
    let recipients = teamMembers.map((user) => ({ user }));
    if (audience !== "team") {
      const one = teamMembers.find((u) => u.Id === audience);
      if (!one) back(teamId, { error: "Pick a valid recipient." });
      recipients = [{ user: one }];
    }
    const outcome = await sendNotification({
      source: c.source,
      teamId,
      teamName: teamName(c, teamId),
      type: "custom",
      recipients,
      sentBy: c.session.email,
      subjectOverride: subject,
      bodyOverride: body,
    });
    await writeAudit(c.session, {
      action: "custom_notification_sent",
      targetType: "notification",
      targetLabel: subject,
      teamId,
      detail: `${recipients.length} recipient(s), status ${outcome.status}`,
    });
    back(teamId, outcome.sent > 0 ? { ok: `Sent to ${outcome.sent} recipient(s).` } : { error: `Send ${outcome.status} — SMTP may not be configured (attempt logged).` });
  }

  return (
    <>
      <LcPageHeader
        title="Notifications"
        subtitle={
          brand.manageable ? (
            <>
              {team.Name} is on the <span className="font-semibold">{brand.brand}</span> brand — you manage its notification templates here. Reminders
              send automatically for active templates; you can also trigger sends manually.
            </>
          ) : (
            <>
              {team.Name} uses the <span className="font-semibold">{brand.brand ?? "Jericho default"}</span> brand — templates are managed centrally by
              Jericho. You can still trigger and resend notifications below.
            </>
          )
        }
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-lc-ink">Templates</h2>
            <form method="GET" className="flex items-center gap-2 text-sm">
              <input type="hidden" name="team" value={team.Id} />
              <span className="text-xs font-semibold text-lc-muted">Editing</span>
              <select name="course" defaultValue={courseScope} className="rounded-lg border border-lc-line bg-white px-2.5 py-1.5 text-xs font-medium max-w-56">
                <option value="">Team default templates</option>
                {teamCourses.filter((c) => !c.CourseTeamLibrary).map((c) => (
                  <option key={c.Id} value={c.Id}>
                    Course: {c.Name}
                  </option>
                ))}
              </select>
              <button type="submit" className={lcBtnSecondary}>
                Go
              </button>
            </form>
          </div>
          {scopeCourse ? (
            <p className="text-xs text-lc-muted">
              Editing per-course overrides for <span className="font-semibold text-lc-ink">{scopeCourse.Name}</span>. Where no override exists, the team
              default (then the built-in default) is used.
            </p>
          ) : (
            <p className="text-xs text-lc-muted">Editing the team default templates. Pick a course above to override messaging for that course.</p>
          )}
          {TEMPLATE_TYPES.map(({ type, label, hint }) => {
            const tpl = templates.find((t) => t.type === type);
            const editHref = `/learning-center/admin/notifications?team=${encodeURIComponent(team.Id)}${courseScope ? `&course=${encodeURIComponent(courseScope)}` : ""}&edit=${type}`;
            const cancelHref = `/learning-center/admin/notifications?team=${encodeURIComponent(team.Id)}${courseScope ? `&course=${encodeURIComponent(courseScope)}` : ""}`;
            return (
              <LcPanel key={type}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lc-ink">{label}</span>
                      {tpl ? (
                        tpl.active ? (
                          <LcBadge tone="purple">Custom · active</LcBadge>
                        ) : (
                          <LcBadge tone="neutral">Custom · off</LcBadge>
                        )
                      ) : (
                        <LcBadge tone="neutral">Default copy</LcBadge>
                      )}
                    </div>
                    <div className="text-xs text-lc-muted mt-0.5">{hint}</div>
                    <div className="text-xs text-lc-ink mt-1.5 font-medium">Subject: {tpl?.subject ?? DEFAULT_TEMPLATES[type].subject}</div>
                  </div>
                  {brand.manageable && (
                    <div className="flex gap-1 shrink-0">
                      <a href={editHref} className={lcBtnGhost}>
                        {tpl ? "Edit" : "Customize"}
                      </a>
                      {tpl && (
                        <form action={removeTemplate} className="inline">
                          <input type="hidden" name="team" value={team.Id} />
                          <input type="hidden" name="id" value={tpl.id} />
                          <input type="hidden" name="label" value={tpl.name} />
                          <button type="submit" className={lcBtnGhost}>
                            Reset to default
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>

                {editType === type && brand.manageable && editDefaults && (
                  <form action={save} className="mt-4 border-t border-lc-line pt-4 space-y-2.5">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="type" value={type} />
                    <input type="hidden" name="courseId" value={courseScope} />
                    <input type="text" name="name" defaultValue={editDefaults.name} required placeholder="Template name" className={lcInputCls} />
                    <input type="text" name="subject" defaultValue={editDefaults.subject} required placeholder="Email subject" className={lcInputCls} />
                    <textarea name="body" defaultValue={editDefaults.body} required rows={7} className={`${lcInputCls} font-mono text-xs`} />
                    <div className="text-[11px] text-lc-muted">
                      Placeholders: {TEMPLATE_PLACEHOLDERS.join(" ")} — resolved per recipient ({"{{login_link}}"} becomes their personal Litmos sign-in
                      link).
                    </div>
                    <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
                      <input type="checkbox" name="active" defaultChecked={editDefaults.active} className="accent-lc-purple" /> Active (used for sends
                      and automatic reminders)
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" className={lcBtnPrimary}>
                        Save template
                      </button>
                      <a href={cancelHref} className={lcBtnSecondary}>
                        Cancel
                      </a>
                    </div>
                  </form>
                )}
              </LcPanel>
            );
          })}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold text-lc-ink">Send now</h2>
          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-1">Resend a sign-in link</h3>
            <p className="text-xs text-lc-muted mb-3">
              Fetches the member&apos;s current Litmos LoginKey and emails it with your welcome template. (Litmos itself has no resend API.)
            </p>
            <form action={resendLogin} className="flex gap-2">
              <input type="hidden" name="team" value={team.Id} />
              <select name="userId" required className={lcSelectCls} defaultValue="">
                <option value="" disabled>
                  Choose a member…
                </option>
                {members.map((m) => (
                  <option key={m.Id} value={m.Id}>
                    {m.FirstName} {m.LastName} — {m.Email}
                  </option>
                ))}
              </select>
              <button type="submit" className={`${lcBtnPrimary} shrink-0`}>
                Send
              </button>
            </form>
          </LcPanel>

          <LcPanel>
            <h3 className="font-bold text-lc-ink mb-1">Custom message</h3>
            <p className="text-xs text-lc-muted mb-3">To the whole team or one member. Placeholders work here too.</p>
            <form action={sendCustom} className="space-y-2.5">
              <input type="hidden" name="team" value={team.Id} />
              <select name="audience" className={lcSelectCls} defaultValue="team">
                <option value="team">Everyone on {team.Name}</option>
                {members.map((m) => (
                  <option key={m.Id} value={m.Id}>
                    Only {m.FirstName} {m.LastName}
                  </option>
                ))}
              </select>
              <input type="text" name="subject" required placeholder="Subject" className={lcInputCls} />
              <textarea name="body" required rows={4} placeholder={"Hi {{first_name}},\n\n…"} className={`${lcInputCls} font-mono text-xs`} />
              <button type="submit" className={lcBtnPrimary}>
                Send message
              </button>
            </form>
          </LcPanel>

          <div>
            <h3 className="font-bold text-lc-ink mb-2">Recent sends</h3>
            {sends.length ? (
              <LcTable
                head={
                  <>
                    <th>When</th>
                    <th>Type</th>
                    <th>To</th>
                    <th>Status</th>
                  </>
                }
              >
                {sends.map((s) => (
                  <tr key={s.id}>
                    <td className="text-lc-muted whitespace-nowrap">{ago(s.createdAt)}</td>
                    <td className="text-lc-ink font-medium">{s.type.replaceAll("_", " ")}</td>
                    <td className="text-lc-muted">{s.recipientCount} recipient(s)</td>
                    <td>
                      <LcBadge tone={s.status === "sent" ? "purple" : s.status === "failed" ? "amber" : "neutral"}>{s.status}</LcBadge>
                    </td>
                  </tr>
                ))}
              </LcTable>
            ) : (
              <LcEmpty title="Nothing sent yet" />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
