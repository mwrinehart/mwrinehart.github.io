import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { createLearner, listLmsLearnersMirror, listLmsTeamsMirror, listTeamMembership, setLearnerActive } from "@/lib/modules/lms/catalog";
import { trainingStatsByEmail } from "@/lib/modules/lms/reports";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString() : "never";
}

export default async function LmsLearnersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = first(sp.q);
  const err = first(sp.error);

  const { orgId } = await requireTenant();
  const [learners, teams, membership, training] = await Promise.all([
    listLmsLearnersMirror(orgId, { q: q || undefined }),
    listLmsTeamsMirror(orgId),
    listTeamMembership(orgId),
    trainingStatsByEmail(orgId),
  ]);

  const teamName = new Map(teams.map((t) => [t.litmosId, t.name]));
  const teamsByLearner = new Map<string, string[]>();
  for (const m of membership) {
    const arr = teamsByLearner.get(m.learnerLitmosId) ?? [];
    arr.push(teamName.get(m.teamLitmosId) ?? m.teamLitmosId);
    teamsByLearner.set(m.learnerLitmosId, arr);
  }
  const statsByEmail = new Map(training.map((t) => [t.email.toLowerCase(), t]));
  const statsFor = (email: string | null) => (email ? statsByEmail.get(email.toLowerCase()) : undefined);

  const activeCount = learners.filter((l) => l.active).length;
  const withOverdue = learners.filter((l) => (statsFor(l.email)?.overdue ?? 0) > 0).length;

  async function add(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await createLearner(orgId, {
      email: String(formData.get("email") || ""),
      firstName: String(formData.get("firstName") || ""),
      lastName: String(formData.get("lastName") || ""),
    });
    if (!res.ok) redirect(`/lms/learners?error=${encodeURIComponent(res.error || "Learner creation failed")}`);
    revalidatePath("/lms/learners");
  }

  async function bulkAdd(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const lines = String(formData.get("rows") || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 100);
    const failures: string[] = [];
    for (const line of lines) {
      const [email, firstName, lastName] = line.split(",").map((s) => s.trim());
      if (!email) {
        failures.push(`"${line}": missing email`);
        continue;
      }
      const res = await createLearner(orgId, { email, firstName: firstName || "", lastName: lastName || "" });
      if (!res.ok) failures.push(res.error || `${email}: failed`);
    }
    revalidatePath("/lms/learners");
    if (failures.length) {
      redirect(`/lms/learners?error=${encodeURIComponent(`${failures.length} of ${lines.length} failed: ${failures[0]}`)}`);
    }
  }

  async function setActive(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await setLearnerActive(orgId, String(formData.get("litmosId") || ""), String(formData.get("active") || "") === "1");
    if (!res.ok) redirect(`/lms/learners?error=${encodeURIComponent(res.error || "Learner update failed")}`);
    revalidatePath("/lms/learners");
  }

  return (
    <>
      <PageHeader
        title="Learners"
        subtitle="The org's Litmos user directory, managed from here — no Litmos login needed."
        action={
          <form method="get" className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search name or email…" className={inputCls} />
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
              Search
            </button>
          </form>
        }
      />

      {err && (
        <Panel className="mb-6">
          <p className="text-sm text-jericho-bad">{err}</p>
        </Panel>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Stat label="Learners" value={learners.length} hint={q ? `matching “${q}”` : undefined} />
        <Stat label="Active" value={activeCount} />
        <Stat label="With overdue training" value={withOverdue} />
      </div>

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Add learner</h3>
        <form action={add} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <label className="block md:col-span-2">
            <span className="text-xs text-jericho-muted">Email</span>
            <input name="email" type="email" required placeholder="jane@company.com" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">First name</span>
            <input name="firstName" required placeholder="Jane" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Last name</span>
            <input name="lastName" required placeholder="Doe" className={`mt-1 ${inputCls}`} />
          </label>
          <div className="md:col-span-4">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Add learner
            </button>
            <span className="text-xs text-jericho-muted ml-3">Created in Litmos via API, then mirrored here.</span>
          </div>
        </form>
      </Panel>

      <Panel className="mb-6">
        <details>
          <summary className="cursor-pointer font-medium">Bulk add</summary>
          <form action={bulkAdd} className="mt-3">
            <label className="block">
              <span className="text-xs text-jericho-muted">One learner per line: email, First, Last (up to 100 lines)</span>
              <textarea
                name="rows"
                rows={6}
                required
                placeholder={"jane@company.com, Jane, Doe\nsam@company.com, Sam, Reyes"}
                className={`mt-1 ${inputCls} font-mono`}
              />
            </label>
            <div className="mt-2">
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Add all
              </button>
              <span className="text-xs text-jericho-muted ml-3">Each line is created in Litmos individually; failures are summarized above.</span>
            </div>
          </form>
        </details>
      </Panel>

      {learners.length === 0 ? (
        q ? (
          <EmptyState title="No learners match">
            No mirrored learner matches “{q}”. <Link href="/lms/learners" className="text-jericho-accent hover:underline">Clear the search</Link>.
          </EmptyState>
        ) : (
          <EmptyState title="No learners in the mirror yet">
            Run a sync from <Link href="/lms/settings" className="text-jericho-accent hover:underline">LMS settings</Link> to pull the Litmos
            user directory, or add a learner above.
          </EmptyState>
        )
      ) : (
        <Panel className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-4 py-3 font-medium">Learner</th>
                <th className="px-4 py-3 font-medium">Teams</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">Open</th>
                <th className="px-4 py-3 font-medium">Overdue</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => {
                const name = l.fullName || [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || l.litmosId;
                const memberTeams = teamsByLearner.get(l.litmosId);
                const stats = statsFor(l.email);
                const overdue = stats?.overdue ?? 0;
                return (
                  <tr key={l.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-jericho-text">{name}</div>
                      {l.email && <div className="text-xs text-jericho-muted">{l.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">
                      <div className="truncate max-w-[180px]" title={memberTeams?.join(", ")}>
                        {memberTeams?.join(", ") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{stats?.completed ?? 0}</td>
                    <td className="px-4 py-3 text-jericho-muted">{stats?.open ?? 0}</td>
                    <td className={`px-4 py-3 ${overdue > 0 ? "text-jericho-bad" : "text-jericho-muted"}`}>{overdue}</td>
                    <td className="px-4 py-3 text-jericho-muted">{fmtDate(l.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={l.active ? "low" : "muted"}>{l.active ? "active" : "inactive"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {l.email && (
                        <Link href={`/lms/assignments?learner=${encodeURIComponent(l.email)}`} className="text-jericho-accent hover:underline mr-3">
                          assign
                        </Link>
                      )}
                      <form action={setActive} className="inline">
                        <input type="hidden" name="litmosId" value={l.litmosId} />
                        <input type="hidden" name="active" value={l.active ? "0" : "1"} />
                        <button
                          className={l.active ? "text-jericho-muted hover:text-jericho-bad" : "text-jericho-accent hover:underline"}
                          type="submit"
                        >
                          {l.active ? "deactivate" : "reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
