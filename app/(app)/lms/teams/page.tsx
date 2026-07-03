import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUserEmail, requireTenant } from "@/lib/platform/org";
import {
  addLearnerToTeam,
  createTeam,
  listLmsCoursesMirror,
  listLmsLearnersMirror,
  listLmsTeamsMirror,
  listTeamMembership,
  removeLearnerFromTeam,
} from "@/lib/modules/lms/catalog";
import { assignCourseToTeam } from "@/lib/modules/lms/assignments";
import type { LmsCourseRow, LmsLearnerRow, LmsTeamMemberRow, LmsTeamRow } from "@/lib/modules/lms/schema";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

// Date-only inputs mean "by the end of that day" — pin to end-of-day UTC.
function parseDueDate(raw: string): number | undefined {
  return raw ? Date.parse(`${raw}T23:59:59.999Z`) : undefined;
}

export default async function LmsTeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const err = first(sp.error);

  const { orgId } = await requireTenant();
  const [teams, membership, learners, courses] = await Promise.all([
    listLmsTeamsMirror(orgId),
    listTeamMembership(orgId),
    listLmsLearnersMirror(orgId),
    listLmsCoursesMirror(orgId),
  ]);

  const learnerById = new Map<string, LmsLearnerRow>(learners.map((l) => [l.litmosId, l]));
  const membersByTeam = new Map<string, LmsTeamMemberRow[]>();
  for (const m of membership) {
    const arr = membersByTeam.get(m.teamLitmosId) ?? [];
    arr.push(m);
    membersByTeam.set(m.teamLitmosId, arr);
  }
  const teamIds = new Set(teams.map((t) => t.litmosId));
  const topLevel = teams.filter((t) => !t.parentLitmosId || !teamIds.has(t.parentLitmosId));
  const childrenOf = (parent: LmsTeamRow) => teams.filter((t) => t.parentLitmosId === parent.litmosId);

  async function create(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await createTeam(orgId, {
      name: String(formData.get("name") || ""),
      description: String(formData.get("description") || "") || undefined,
      parentLitmosId: String(formData.get("parent") || "") || undefined,
    });
    if (!res.ok) redirect(`/lms/teams?error=${encodeURIComponent(res.error || "Team creation failed")}`);
    revalidatePath("/lms/teams");
  }

  async function addMember(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await addLearnerToTeam(orgId, String(formData.get("teamLitmosId") || ""), String(formData.get("learnerLitmosId") || ""));
    if (!res.ok) redirect(`/lms/teams?error=${encodeURIComponent(res.error || "Could not add learner to team")}`);
    revalidatePath("/lms/teams");
  }

  async function removeMember(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await removeLearnerFromTeam(orgId, String(formData.get("teamLitmosId") || ""), String(formData.get("learnerLitmosId") || ""));
    if (!res.ok) redirect(`/lms/teams?error=${encodeURIComponent(res.error || "Could not remove learner from team")}`);
    revalidatePath("/lms/teams");
  }

  async function assignCourse(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const courseId = String(formData.get("courseLitmosId") || "");
    await assignCourseToTeam(orgId, String(formData.get("teamLitmosId") || ""), courseId, {
      dueDate: parseDueDate(String(formData.get("dueDate") || "")),
      assignedBy: (await getUserEmail()) ?? undefined,
    });
    revalidatePath("/lms/assignments");
    redirect(`/lms/assignments?course=${encodeURIComponent(courseId)}`);
  }

  function teamCard(team: LmsTeamRow) {
    const members = membersByTeam.get(team.litmosId) ?? [];
    const memberIds = new Set(members.map((m) => m.learnerLitmosId));
    const addable = learners.filter((l) => l.active && !memberIds.has(l.litmosId));
    return (
      <Panel key={team.id}>
        <div className="flex items-baseline gap-2">
          <h3 className="font-medium">{team.name}</h3>
          <span className="text-xs text-jericho-muted">
            {members.length} member{members.length === 1 ? "" : "s"}
          </span>
        </div>
        {team.description && <p className="text-sm text-jericho-muted mt-0.5">{team.description}</p>}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {members.map((m) => {
            const learner = learnerById.get(m.learnerLitmosId);
            return (
              <form key={m.id} action={removeMember} className="inline-flex items-center gap-1.5 rounded-full border border-jericho-border bg-jericho-bg px-2.5 py-0.5 text-xs">
                <input type="hidden" name="teamLitmosId" value={team.litmosId} />
                <input type="hidden" name="learnerLitmosId" value={m.learnerLitmosId} />
                <span>{learner?.fullName || learner?.email || m.learnerLitmosId}</span>
                <button className="text-jericho-muted hover:text-jericho-bad" type="submit" title="Remove from team">
                  ×
                </button>
              </form>
            );
          })}
          {members.length === 0 && <span className="text-xs text-jericho-muted">No members yet.</span>}
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <form action={addMember} className="flex gap-2 items-end">
            <input type="hidden" name="teamLitmosId" value={team.litmosId} />
            <label className="block flex-1">
              <span className="text-xs text-jericho-muted">Add member</span>
              <select name="learnerLitmosId" required className={`mt-1 ${inputCls}`}>
                {addable.map((l) => (
                  <option key={l.litmosId} value={l.litmosId}>
                    {l.fullName || l.email || l.litmosId}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit" disabled={addable.length === 0}>
              Add
            </button>
          </form>

          <form action={assignCourse} className="flex gap-2 items-end">
            <input type="hidden" name="teamLitmosId" value={team.litmosId} />
            <label className="block flex-1">
              <span className="text-xs text-jericho-muted">Assign course to team</span>
              <select name="courseLitmosId" required className={`mt-1 ${inputCls}`}>
                {courses.map((c) => (
                  <option key={c.litmosId} value={c.litmosId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-jericho-muted">Due</span>
              <input name="dueDate" type="date" className={`mt-1 ${inputCls}`} />
            </label>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Assign
            </button>
          </form>
        </div>
      </Panel>
    );
  }

  return (
    <>
      <PageHeader title="Teams" subtitle="Litmos teams, managed from here — membership and team-wide course assignment." />

      {err && (
        <Panel className="mb-6">
          <p className="text-sm text-jericho-bad">{err}</p>
        </Panel>
      )}

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">New team</h3>
        <form action={create} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-jericho-muted">Name</span>
            <input name="name" required placeholder="Clinical staff" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Description</span>
            <input name="description" placeholder="Optional" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Parent team</span>
            <select name="parent" className={`mt-1 ${inputCls}`}>
              <option value="">— none —</option>
              {teams.map((t) => (
                <option key={t.litmosId} value={t.litmosId}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-3">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Create team
            </button>
          </div>
        </form>
      </Panel>

      {teams.length === 0 ? (
        <EmptyState title="No teams yet">Create one above, or run a sync from LMS settings to pull teams from Litmos.</EmptyState>
      ) : (
        <div className="space-y-3">
          {topLevel.map((team) => {
            const children = childrenOf(team);
            return (
              <div key={team.id}>
                {teamCard(team)}
                {children.length > 0 && <div className="border-l border-jericho-border pl-4 ml-4 mt-3 space-y-3">{children.map((c) => teamCard(c))}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
