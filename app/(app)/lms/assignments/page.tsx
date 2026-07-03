import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getUserEmail, requireTenant } from "@/lib/platform/org";
import {
  activateLmsNow,
  assignCourseToTeam,
  cancelLmsAssignment,
  createLmsAssignments,
  listLmsAssignments,
  lmsAssignmentStats,
  setLmsDueDate,
} from "@/lib/modules/lms/assignments";
import { listLmsCoursesMirror, listLmsLearnersMirror, listLmsTeamsMirror } from "@/lib/modules/lms/catalog";
import { sendLmsNotice } from "@/lib/modules/lms/notifications";
import { assignmentBadgeTone, OPEN_ASSIGNMENT_STATUSES, type AssignmentStatus } from "@/lib/modules/lms/types";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

const STATUSES: AssignmentStatus[] = ["pending", "scheduled", "active", "overdue", "completed", "failed", "cancelled"];

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString() : "—";
}

// Date-only inputs mean "by the end of that day" — pin to end-of-day UTC.
function parseDueDate(raw: string): number | null {
  return raw ? Date.parse(`${raw}T23:59:59.999Z`) : null;
}

export default async function LmsAssignmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = first(sp.status);
  const course = first(sp.course);
  const learner = first(sp.learner);
  const q = first(sp.q);
  const err = first(sp.error);

  const { orgId } = await requireTenant();
  const [stats, rows, courses, teams] = await Promise.all([
    lmsAssignmentStats(orgId),
    listLmsAssignments(orgId, { status: status || undefined, courseId: course || undefined, q: q || undefined, limit: 300 }),
    listLmsCoursesMirror(orgId, { activeOnly: true }),
    listLmsTeamsMirror(orgId),
  ]);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const filtered = Boolean(status || course || q);

  function chipHref(nextStatus: string): string {
    const params = new URLSearchParams();
    if (nextStatus) params.set("status", nextStatus);
    if (course) params.set("course", course);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `/lms/assignments?${s}` : "/lms/assignments";
  }

  async function assignOne(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const learnerEmail = String(formData.get("learnerEmail") || "").trim().toLowerCase();
    const courseId = String(formData.get("courseId") || "");
    const rawDue = String(formData.get("dueDate") || "");
    const rawScheduled = String(formData.get("scheduledFor") || "");
    const [mirrorCourses, mirrorLearners, userEmail] = await Promise.all([
      listLmsCoursesMirror(orgId),
      listLmsLearnersMirror(orgId, { q: learnerEmail, limit: 10 }),
      getUserEmail(),
    ]);
    const courseName = mirrorCourses.find((c) => c.litmosId === courseId)?.name;
    const learnerName = mirrorLearners.find((l) => l.email?.toLowerCase() === learnerEmail)?.fullName ?? undefined;
    const { created } = await createLmsAssignments(orgId, [
      {
        learnerEmail,
        learnerName,
        courseLitmosId: courseId,
        courseName,
        scheduledFor: rawScheduled ? new Date(rawScheduled).getTime() : undefined,
        dueDate: parseDueDate(rawDue) ?? undefined,
        assignedBy: userEmail ?? undefined,
      },
    ]);
    if (created > 0) {
      await sendLmsNotice(
        orgId,
        "assignment_created",
        {
          learner: learnerName || learnerEmail,
          learnerEmail,
          course: courseName || courseId,
          courseId,
          dueDate: rawDue || "",
          dueClause: rawDue ? `, due ${rawDue}` : "",
        },
        { learnerEmail },
      );
    }
    revalidatePath("/lms/assignments");
  }

  async function assignBulk(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await assignCourseToTeam(orgId, String(formData.get("teamId") || ""), String(formData.get("courseId") || ""), {
      dueDate: parseDueDate(String(formData.get("dueDate") || "")) ?? undefined,
      assignedBy: (await getUserEmail()) ?? undefined,
    });
    revalidatePath("/lms/assignments");
  }

  async function setDue(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await setLmsDueDate(orgId, String(formData.get("id") || ""), parseDueDate(String(formData.get("dueDate") || "")));
    revalidatePath("/lms/assignments");
  }

  async function activate(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await activateLmsNow(orgId, String(formData.get("id") || ""));
    revalidatePath("/lms/assignments");
  }

  async function cancel(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    await cancelLmsAssignment(orgId, String(formData.get("id") || ""));
    revalidatePath("/lms/assignments");
  }

  return (
    <>
      <PageHeader
        title="Assignments"
        subtitle="Every training assignment with its due date — assign individually or by team, and manage the lifecycle here."
        action={
          <form method="get" className="flex gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            {course && <input type="hidden" name="course" value={course} />}
            <input name="q" defaultValue={q} placeholder="Search learner or course…" className={inputCls} />
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

      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={chipHref("")}
          className={`rounded-full border px-3 py-1 text-xs ${!status ? "border-jericho-accent text-jericho-accent" : "border-jericho-border text-jericho-muted hover:text-jericho-text"}`}
        >
          all: {total}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={chipHref(status === s ? "" : s)}
            className={`rounded-full border px-3 py-1 text-xs ${status === s ? "border-jericho-accent text-jericho-accent" : "border-jericho-border text-jericho-muted hover:text-jericho-text"}`}
          >
            {s}: {stats[s] ?? 0}
          </Link>
        ))}
      </div>

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Assign a course</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <form action={assignOne} className="space-y-2">
            <label className="block">
              <span className="text-xs text-jericho-muted">Learner email</span>
              <input name="learnerEmail" type="email" required defaultValue={learner} placeholder="user@company.com" className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block">
              <span className="text-xs text-jericho-muted">Course</span>
              <select name="courseId" required defaultValue={course} className={`mt-1 ${inputCls}`}>
                {courses.map((c) => (
                  <option key={c.litmosId} value={c.litmosId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-jericho-muted">Due date</span>
                <input name="dueDate" type="date" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-xs text-jericho-muted">Schedule for</span>
                <input name="scheduledFor" type="datetime-local" className={`mt-1 ${inputCls}`} />
              </label>
            </div>
            <p className="text-xs text-jericho-muted">Leave “schedule for” empty to assign immediately.</p>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Assign
            </button>
          </form>

          <form action={assignBulk} className="space-y-2">
            <label className="block">
              <span className="text-xs text-jericho-muted">Team</span>
              <select name="teamId" required className={`mt-1 ${inputCls}`}>
                {teams.map((t) => (
                  <option key={t.litmosId} value={t.litmosId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-jericho-muted">Course</span>
              <select name="courseId" required className={`mt-1 ${inputCls}`}>
                {courses.map((c) => (
                  <option key={c.litmosId} value={c.litmosId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-jericho-muted">Due date</span>
              <input name="dueDate" type="date" className={`mt-1 ${inputCls}`} />
            </label>
            <p className="text-xs text-jericho-muted">
              One assignment per team member; existing open assignments are skipped. Reminders follow your Notifications cadence.
            </p>
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Assign to team
            </button>
          </form>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState title="No assignments match">
          {filtered ? (
            <>
              Nothing matches the current filters.{" "}
              <Link href="/lms/assignments" className="text-jericho-accent hover:underline">
                Clear filters
              </Link>
              .
            </>
          ) : (
            <>Assign a course above, or let rules and compliance profiles create assignments automatically.</>
          )}
        </EmptyState>
      ) : (
        <Panel className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-4 py-3 font-medium">Learner</th>
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Assigned</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-jericho-text">{r.learnerName || r.learnerEmail}</div>
                    {r.learnerName && <div className="text-xs text-jericho-muted">{r.learnerEmail}</div>}
                    {r.status === "failed" && r.notes && <div className="text-xs text-jericho-bad mt-0.5">{r.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-jericho-muted">{r.courseName || r.courseLitmosId}</td>
                  <td className="px-4 py-3">
                    <Badge tone={assignmentBadgeTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-jericho-muted">{fmtDate(r.assignedAt)}</td>
                  <td className="px-4 py-3">
                    <form action={setDue} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      <input
                        name="dueDate"
                        type="date"
                        defaultValue={r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : ""}
                        className="rounded-lg border border-jericho-border bg-jericho-bg px-2 py-1 text-xs outline-none focus:border-jericho-accent"
                      />
                      <button className="text-xs text-jericho-accent hover:underline" type="submit">
                        set
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-jericho-muted">
                    {fmtDate(r.completedAt)}
                    {r.score != null && <span className="text-xs"> · {r.score}%</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {(r.status === "scheduled" || r.status === "failed") && (
                      <form action={activate} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-jericho-accent hover:underline mr-3" type="submit">
                          activate
                        </button>
                      </form>
                    )}
                    {(OPEN_ASSIGNMENT_STATUSES as string[]).includes(r.status) && (
                      <form action={cancel} className="inline">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
                          cancel
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
