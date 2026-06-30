import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUserEmail } from "@/lib/platform/org";
import { isPlatformAdmin, listAllOrgs, listAllUsers, PLATFORM_PLANS, requirePlatformAdmin, setOrgPlan } from "@/lib/platform/admin";
import { PageHeader, Panel, Stat } from "@/components/ui";

const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);

// Platform-admin console — visibility across ALL organizations and users
// (independent of org membership). Gated by PLATFORM_ADMIN_EMAILS, not org role.
// Impersonation remains a deferred follow-up; this is read-only plus plan control.
export default async function AdminPage() {
  if (!isPlatformAdmin(await getUserEmail())) redirect("/dashboard");
  const [orgs, users] = await Promise.all([listAllOrgs(), listAllUsers()]);

  async function changePlan(formData: FormData) {
    "use server";
    await requirePlatformAdmin();
    await setOrgPlan(String(formData.get("orgId") || ""), String(formData.get("plan") || "free"));
    revalidatePath("/admin");
  }

  return (
    <>
      <PageHeader title="Platform admin" subtitle="All organizations and users across the platform." />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Organizations" value={orgs.length} />
        <Stat label="Users" value={users.length} />
        <Stat label="Members total" value={orgs.reduce((n, o) => n + o.members, 0)} />
      </div>

      <h3 className="font-medium mb-3 text-sm">Organizations</h3>
      <Panel className="p-0 overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">Org</th>
                <th className="px-5 py-3 font-medium">Members</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Plan</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="text-jericho-text">{o.name}</div>
                    <div className="text-xs text-jericho-muted">{o.slug}</div>
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{o.members}</td>
                  <td className="px-5 py-3 text-jericho-muted">{fmtDate(o.createdAt)}</td>
                  <td className="px-5 py-3">
                    <form action={changePlan} className="flex items-center gap-2">
                      <input type="hidden" name="orgId" value={o.id} />
                      <select
                        name="plan"
                        defaultValue={o.plan}
                        className="rounded-lg border border-jericho-border bg-jericho-bg px-2 py-1 text-sm outline-none focus:border-jericho-accent"
                      >
                        {PLATFORM_PLANS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <button className="text-xs text-jericho-accent hover:underline" type="submit">
                        set
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <h3 className="font-medium mb-3 text-sm">Users (most recent {users.length})</h3>
      <Panel className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Orgs</th>
                <th className="px-5 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="text-jericho-text">{u.name || u.email || u.id}</div>
                    {u.email && <div className="text-xs text-jericho-muted">{u.email}</div>}
                  </td>
                  <td className="px-5 py-3 text-jericho-muted">{u.orgCount}</td>
                  <td className="px-5 py-3 text-jericho-muted">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
