// Manage users: everything a team admin can do to people in their scope —
// add existing Litmos users to the team, create new users (with or without the
// Litmos welcome email), resend sign-in links, promote/demote team admins and
// leaders, remove from team, and create sub-teams. Per-user drill-down (edit
// profile, memberships, per-course actions) lives at ./[id].

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext, assertTeamInScope, selectedTeam, teamName } from "@/lib/modules/learning-center/context";
import { writeAudit } from "@/lib/modules/learning-center/audit";
import { buildTeamTree, flattenTeamTree } from "@/lib/modules/learning-center/scope";
import { sendNotification, getTeamBrand } from "@/lib/modules/learning-center/notifications";
import { TeamPicker } from "@/components/learning-center/TeamPicker";
import { LcBadge, LcEmpty, LcFlash, LcPageHeader, LcPanel, LcTable, lcBtnGhost, lcBtnPrimary, lcBtnSecondary, lcInputCls } from "@/components/learning-center/ui";

function back(teamId: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ team: teamId, ...extra });
  redirect(`/learning-center/admin/users?${q.toString()}`);
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; q?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext();
  const team = selectedTeam(ctx, params.team);
  if (!team) {
    return (
      <>
        <LcPageHeader title="Users" />
        <LcEmpty title="No teams in your scope">Ask an account owner to make you a team admin in Litmos.</LcEmpty>
      </>
    );
  }

  const [members, admins, leaders] = await Promise.all([
    ctx.source.listTeamUsers(team.Id),
    ctx.source.listTeamAdmins(team.Id).catch(() => []),
    ctx.source.listTeamLeaders(team.Id).catch(() => []),
  ]);
  const adminIds = new Set(admins.map((a) => a.Id));
  const leaderIds = new Set(leaders.map((l) => l.Id));

  const q = (params.q ?? "").trim().toLowerCase();
  const filtered = q
    ? members.filter((m) => [m.FirstName, m.LastName, m.Email, `${m.FirstName} ${m.LastName}`].some((f) => f?.toLowerCase().includes(q)))
    : members;

  const teamOptions = flattenTeamTree(buildTeamTree(ctx.allTeams, ctx.scopeIds));

  // ── actions (each re-authenticates and re-checks scope) ─────────────────────

  async function addExistingUser(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const sendMessage = formData.get("sendMessage") === "on";
    const user = await c.source.findUserByEmail(email);
    if (!user) back(teamId, { error: `No Litmos user found with email ${email}. Create them below instead.` });
    try {
      await c.source.addUsersToTeam(teamId, [user.Id], sendMessage);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Could not add the user." });
    }
    await writeAudit(c.session, {
      action: "user_added_to_team",
      targetType: "user",
      targetId: user.Id,
      targetLabel: email,
      teamId,
      detail: `Added to ${teamName(c, teamId)}`,
    });
    revalidatePath("/learning-center/admin/users");
    back(teamId, { ok: `${email} added to the team.` });
  }

  async function createUser(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const input = {
      FirstName: String(formData.get("firstName") ?? "").trim(),
      LastName: String(formData.get("lastName") ?? "").trim(),
      Email: String(formData.get("email") ?? "").trim(),
      JobTitle: String(formData.get("jobTitle") ?? "").trim() || undefined,
      sendWelcomeEmail: formData.get("sendWelcome") === "on",
    };
    if (!input.FirstName || !input.LastName || !input.Email) back(teamId, { error: "First name, last name, and email are required." });
    let created;
    try {
      created = await c.source.createUser(input);
      await c.source.addUsersToTeam(teamId, [created.Id], false);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Could not create the user." });
    }
    await writeAudit(c.session, {
      action: "user_created",
      targetType: "user",
      targetId: created.Id,
      targetLabel: input.Email,
      teamId,
      detail: `Created and added to ${teamName(c, teamId)}${input.sendWelcomeEmail ? " (Litmos welcome email sent)" : ""}`,
    });
    revalidatePath("/learning-center/admin/users");
    back(teamId, { ok: `${input.Email} created and added to the team.` });
  }

  async function createSubTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const name = String(formData.get("name") ?? "").trim();
    if (!name) back(teamId, { error: "Sub-team name is required." });
    let subTeam;
    try {
      subTeam = await c.source.createSubTeam(teamId, name);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Could not create the sub-team." });
    }
    await writeAudit(c.session, {
      action: "subteam_created",
      targetType: "team",
      targetId: subTeam.Id,
      targetLabel: name,
      teamId,
      detail: `Under ${teamName(c, teamId)}`,
    });
    revalidatePath("/learning-center/admin/users");
    back(subTeam.Id, { ok: `Sub-team "${name}" created.` });
  }

  async function resendLogin(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const userId = String(formData.get("userId") ?? "");
    const users = await c.source.listTeamUsers(teamId);
    const user = users.find((u) => u.Id === userId);
    if (!user) back(teamId, { error: "That user is not on this team." });
    const outcome = await sendNotification({
      source: c.source,
      teamId,
      teamName: teamName(c, teamId),
      type: "welcome",
      recipients: [{ user }],
      sentBy: c.session.email,
    });
    await writeAudit(c.session, {
      action: "login_link_resent",
      targetType: "user",
      targetId: user.Id,
      targetLabel: user.Email,
      teamId,
      detail: `Send status: ${outcome.status}`,
    });
    back(teamId, outcome.status === "sent" ? { ok: `Sign-in link emailed to ${user.Email}.` } : { error: `Send ${outcome.status} — check SMTP configuration (logged either way).` });
  }

  async function toggleRole(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const userId = String(formData.get("userId") ?? "");
    const role = String(formData.get("role") ?? ""); // admin | leader
    const op = String(formData.get("op") ?? ""); // promote | demote
    const users = await c.source.listTeamUsers(teamId);
    const user = users.find((u) => u.Id === userId);
    if (!user || !["admin", "leader"].includes(role) || !["promote", "demote"].includes(op)) back(teamId, { error: "Invalid request." });
    try {
      if (role === "admin") {
        if (op === "promote") await c.source.promoteTeamAdmin(teamId, userId);
        else await c.source.demoteTeamAdmin(teamId, userId);
      } else {
        if (op === "promote") await c.source.promoteTeamLeader(teamId, userId);
        else await c.source.demoteTeamLeader(teamId, userId);
      }
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Role change failed." });
    }
    await writeAudit(c.session, {
      action: `team_${role}_${op}d`,
      targetType: "user",
      targetId: userId,
      targetLabel: user.Email,
      teamId,
    });
    revalidatePath("/learning-center/admin/users");
    back(teamId, { ok: `${user.Email} ${op}d ${op === "promote" ? "to" : "from"} team ${role}.` });
  }

  async function removeFromTeam(formData: FormData) {
    "use server";
    const c = await getAdminContext();
    const teamId = String(formData.get("team") ?? "");
    assertTeamInScope(c, teamId);
    const userId = String(formData.get("userId") ?? "");
    const users = await c.source.listTeamUsers(teamId);
    const user = users.find((u) => u.Id === userId);
    if (!user) back(teamId, { error: "That user is not on this team." });
    try {
      await c.source.removeUserFromTeam(teamId, userId);
    } catch (e) {
      back(teamId, { error: e instanceof Error ? e.message : "Remove failed." });
    }
    await writeAudit(c.session, {
      action: "user_removed_from_team",
      targetType: "user",
      targetId: userId,
      targetLabel: user.Email,
      teamId,
      detail: `Removed from ${teamName(c, teamId)}`,
    });
    revalidatePath("/learning-center/admin/users");
    back(teamId, { ok: `${user.Email} removed from the team.` });
  }

  const brand = await getTeamBrand(ctx.source, team.Id).catch(() => null);

  return (
    <>
      <LcPageHeader
        title="Users"
        subtitle={`${members.length} active member(s) in ${team.Name}${brand?.brand ? ` · Brand: ${brand.brand}` : ""}`}
        action={<TeamPicker teams={teamOptions} selectedId={team.Id} />}
      />
      <LcFlash ok={params.ok} error={params.error} />

      <form method="GET" className="mb-4 flex gap-2 max-w-md">
        <input type="hidden" name="team" value={team.Id} />
        <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Search name or email…" className={lcInputCls} />
        <button type="submit" className={lcBtnSecondary}>
          Search
        </button>
      </form>

      {filtered.length ? (
        <LcTable
          head={
            <>
              <th>Member</th>
              <th>Role</th>
              <th className="w-96">Actions</th>
            </>
          }
        >
          {filtered.map((m) => (
            <tr key={m.Id}>
              <td>
                <Link href={`/learning-center/admin/users/${encodeURIComponent(m.Id)}?team=${encodeURIComponent(team.Id)}`} className="font-semibold text-lc-ink hover:text-lc-purple">
                  {m.FirstName} {m.LastName}
                </Link>
                <div className="text-xs text-lc-muted">{m.Email}</div>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {adminIds.has(m.Id) && <LcBadge tone="purple">Team admin</LcBadge>}
                  {leaderIds.has(m.Id) && <LcBadge tone="ink">Team leader</LcBadge>}
                  {!adminIds.has(m.Id) && !leaderIds.has(m.Id) && <LcBadge tone="neutral">Learner</LcBadge>}
                </div>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <form action={resendLogin} className="inline">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="userId" value={m.Id} />
                    <button type="submit" className={lcBtnGhost}>
                      Resend login
                    </button>
                  </form>
                  <form action={toggleRole} className="inline">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="userId" value={m.Id} />
                    <input type="hidden" name="role" value="admin" />
                    <input type="hidden" name="op" value={adminIds.has(m.Id) ? "demote" : "promote"} />
                    <button type="submit" className={lcBtnGhost}>
                      {adminIds.has(m.Id) ? "Demote admin" : "Make admin"}
                    </button>
                  </form>
                  <form action={toggleRole} className="inline">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="userId" value={m.Id} />
                    <input type="hidden" name="role" value="leader" />
                    <input type="hidden" name="op" value={leaderIds.has(m.Id) ? "demote" : "promote"} />
                    <button type="submit" className={lcBtnGhost}>
                      {leaderIds.has(m.Id) ? "Demote leader" : "Make leader"}
                    </button>
                  </form>
                  <form action={removeFromTeam} className="inline">
                    <input type="hidden" name="team" value={team.Id} />
                    <input type="hidden" name="userId" value={m.Id} />
                    <button type="submit" className={lcBtnGhost}>
                      Remove
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </LcTable>
      ) : (
        <LcEmpty title={q ? "No members match your search" : "No members in this team yet"} />
      )}

      <div className="grid gap-6 lg:grid-cols-3 mt-8">
        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-1">Add an existing user</h3>
          <p className="text-xs text-lc-muted mb-3">Adds a current Litmos user to {team.Name}. Team-assigned courses apply automatically.</p>
          <form action={addExistingUser} className="space-y-2.5">
            <input type="hidden" name="team" value={team.Id} />
            <input type="email" name="email" required placeholder="user@company.com" className={lcInputCls} />
            <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
              <input type="checkbox" name="sendMessage" className="accent-lc-purple" /> Send Litmos login email if new to the team
            </label>
            <button type="submit" className={lcBtnPrimary}>
              Add to team
            </button>
          </form>
        </LcPanel>

        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-1">Create a new user</h3>
          <p className="text-xs text-lc-muted mb-3">Creates the user in Litmos and adds them to {team.Name}.</p>
          <form action={createUser} className="space-y-2.5">
            <input type="hidden" name="team" value={team.Id} />
            <div className="flex gap-2">
              <input type="text" name="firstName" required placeholder="First name" className={lcInputCls} />
              <input type="text" name="lastName" required placeholder="Last name" className={lcInputCls} />
            </div>
            <input type="email" name="email" required placeholder="user@company.com" className={lcInputCls} />
            <input type="text" name="jobTitle" placeholder="Job title (optional)" className={lcInputCls} />
            <label className="flex items-center gap-2 text-xs text-lc-muted font-medium">
              <input type="checkbox" name="sendWelcome" defaultChecked className="accent-lc-purple" /> Send the Litmos welcome email
            </label>
            <button type="submit" className={lcBtnPrimary}>
              Create user
            </button>
          </form>
        </LcPanel>

        <LcPanel>
          <h3 className="font-bold text-lc-ink mb-1">Create a sub-team</h3>
          <p className="text-xs text-lc-muted mb-3">Sub-teams under {team.Name} inherit your admin control (not its members).</p>
          <form action={createSubTeam} className="space-y-2.5">
            <input type="hidden" name="team" value={team.Id} />
            <input type="text" name="name" required placeholder="Sub-team name" className={lcInputCls} />
            <button type="submit" className={lcBtnPrimary}>
              Create sub-team
            </button>
          </form>
        </LcPanel>
      </div>
    </>
  );
}
