import Link from "next/link";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/platform/org";
import { changeMemberRole, createInvite, listMembers, listPendingInvites, removeMember, revokeInvite } from "@/lib/platform/orgs";
import { notify } from "@/lib/platform/notify";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";
const ROLES = ["owner", "admin", "member", "viewer"];

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function MembersPage() {
  const { orgId, userId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";
  const [members, pending, base] = await Promise.all([listMembers(orgId), listPendingInvites(orgId), origin()]);

  async function invite(formData: FormData) {
    "use server";
    const { orgId, role: actorRole } = await requireTenant("admin");
    const { token, email, role: invitedRole } = await createInvite(orgId, actorRole, String(formData.get("email") || ""), String(formData.get("role") || "member"));
    // Best-effort email with the accept link (skipped if SMTP isn't configured).
    const link = `${await origin()}/invite/${token}`;
    await notify({
      orgId,
      channel: "email",
      target: email,
      subject: "You've been invited to Jericho Security",
      body: `You've been invited to join as ${invitedRole}. Accept here:\n${link}`,
      module: "platform",
    });
    revalidatePath("/settings/members");
  }
  async function revoke(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await revokeInvite(orgId, String(formData.get("id") || ""));
    revalidatePath("/settings/members");
  }
  async function setRole(formData: FormData) {
    "use server";
    const { orgId, role: actorRole } = await requireTenant("admin");
    await changeMemberRole(orgId, actorRole, String(formData.get("userId") || ""), String(formData.get("role") || "member"));
    revalidatePath("/settings/members");
  }
  async function remove(formData: FormData) {
    "use server";
    const { orgId, role: actorRole } = await requireTenant("admin");
    await removeMember(orgId, actorRole, String(formData.get("userId") || ""));
    revalidatePath("/settings/members");
  }

  return (
    <>
      <PageHeader
        title="Team & invites"
        subtitle="Manage who belongs to this organization and what they can do."
        action={
          <Link href="/settings" className="text-sm text-jericho-accent hover:underline">
            ← Settings
          </Link>
        }
      />

      {isAdmin && (
        <Panel className="mb-6">
          <h3 className="font-medium mb-3">Invite a teammate</h3>
          <form action={invite} className="flex flex-wrap gap-2 items-end">
            <input name="email" type="email" required placeholder="teammate@company.com" className={`${inputCls} flex-1 min-w-[220px]`} />
            <select name="role" defaultValue="member" className={inputCls}>
              {ROLES.filter((r) => r !== "owner" || role === "owner").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Send invite
            </button>
          </form>
          <p className="text-xs text-jericho-muted mt-2">
            We email the invite if SMTP is configured; either way the link appears below. Invites are bound to the email
            address — the invitee must sign in with it.
          </p>
        </Panel>
      )}

      <Panel className="p-0 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-jericho-border font-medium text-sm">Members ({members.length})</div>
        <table className="w-full text-sm">
          <thead className="text-left text-jericho-muted border-b border-jericho-border">
            <tr>
              <th className="px-5 py-3 font-medium">Member</th>
              <th className="px-5 py-3 font-medium">Role</th>
              {isAdmin && <th className="px-5 py-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId} className="border-b border-jericho-border/50 last:border-0">
                <td className="px-5 py-3">
                  <div className="text-jericho-text">{m.name || m.email || m.userId}</div>
                  {m.email && <div className="text-xs text-jericho-muted">{m.email}</div>}
                  {m.userId === userId && <span className="text-[10px] uppercase tracking-wide text-jericho-muted">you</span>}
                </td>
                <td className="px-5 py-3">
                  {isAdmin ? (
                    <form action={setRole} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={m.userId} />
                      <select name="role" defaultValue={m.role} className={inputCls} disabled={role !== "owner" && (m.role === "owner")}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button className="text-xs text-jericho-accent hover:underline" type="submit">
                        update
                      </button>
                    </form>
                  ) : (
                    <Badge tone={m.role === "owner" ? "high" : m.role === "admin" ? "medium" : "low"}>{m.role}</Badge>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-5 py-3 text-right">
                    <form action={remove}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                        remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <h3 className="font-medium mb-3 text-sm">Pending invites ({pending.length})</h3>
      {pending.length === 0 ? (
        <EmptyState title="No pending invites">Invite teammates above to grow your organization.</EmptyState>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {pending.map((inv) => (
                <tr key={inv.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="text-jericho-text">{inv.email}</div>
                    <div className="text-xs text-jericho-muted break-all">
                      {base}/invite/{inv.token}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone="medium">{inv.role}</Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-right">
                      <form action={revoke}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button className="text-jericho-muted hover:text-jericho-bad" type="submit">
                          revoke
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
