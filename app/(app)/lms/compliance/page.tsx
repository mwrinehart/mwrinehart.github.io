import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireTenant, roleAtLeast } from "@/lib/platform/org";
import {
  complianceForecast,
  deleteComplianceProfile,
  listComplianceProfiles,
  listComplianceRecords,
  lmsComplianceOverview,
  recomputeCompliance,
  upsertComplianceProfile,
} from "@/lib/modules/lms/compliance";
import { listLmsCoursesMirror } from "@/lib/modules/lms/catalog";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

const RECORD_STATUSES = ["never", "compliant", "expiring", "expired"] as const;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString() : "—";
}

function num(v: FormDataEntryValue | null, fallback: number): number {
  // Number("") === 0, so a cleared field must fall back rather than save 0.
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function recordTone(status: string): string {
  if (status === "compliant") return "low";
  if (status === "expiring") return "medium";
  if (status === "expired") return "high";
  return "muted"; // never → default muted style
}

export default async function LmsCompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = first(sp.status);
  const profileParam = first(sp.profile);
  const err = first(sp.error);

  const { orgId, role } = await requireTenant();
  const isAdmin = roleAtLeast(role, "admin");

  const [overview, forecast, profiles, records, courses] = await Promise.all([
    lmsComplianceOverview(orgId),
    complianceForecast(orgId),
    listComplianceProfiles(orgId),
    listComplianceRecords(orgId, { status: status || undefined, limit: 500 }),
    listLmsCoursesMirror(orgId, { activeOnly: true }),
  ]);

  const editing = profileParam ? profiles.find((p) => p.id === profileParam) : undefined;
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const courseNameById = new Map(courses.map((c) => [c.litmosId, c.name]));
  for (const p of profiles) if (p.courseName && !courseNameById.has(p.courseLitmosId)) courseNameById.set(p.courseLitmosId, p.courseName);

  const statusQS = status ? `&status=${encodeURIComponent(status)}` : "";
  const listHref = status ? `/lms/compliance?status=${encodeURIComponent(status)}` : "/lms/compliance";

  async function recompute() {
    "use server";
    const { orgId } = await requireTenant("admin");
    await recomputeCompliance(orgId);
    revalidatePath("/lms/compliance");
  }

  async function saveProfile(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    const courseLitmosId = String(formData.get("courseLitmosId") || "");
    // Snapshot the course name at save time so records stay readable if the
    // mirror row later goes inactive.
    const mirror = await listLmsCoursesMirror(orgId);
    await upsertComplianceProfile(orgId, {
      id: String(formData.get("id") || "") || undefined,
      name: String(formData.get("name") || ""),
      courseLitmosId,
      courseName: mirror.find((c) => c.litmosId === courseLitmosId)?.name,
      renewalMonths: num(formData.get("renewalMonths"), 12),
      warnDays: num(formData.get("warnDays"), 30),
      autoReassign: formData.get("autoReassign") === "1",
      enabled: formData.get("enabled") === "1",
    });
    revalidatePath("/lms/compliance");
  }

  async function removeProfile(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("admin");
    await deleteComplianceProfile(orgId, String(formData.get("id") || ""));
    revalidatePath("/lms/compliance");
  }

  const chipCls = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${active ? "border-jericho-accent text-jericho-accent" : "border-jericho-border text-jericho-muted hover:text-jericho-text"}`;

  return (
    <>
      <PageHeader
        title="Compliance"
        subtitle="Renewal windows per course — who's compliant, who's about to lapse, and automatic reassignment."
        action={
          isAdmin ? (
            <form action={recompute}>
              <button className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40" type="submit">
                Recompute now
              </button>
            </form>
          ) : undefined
        }
      />

      {err && (
        <Panel className="mb-6">
          <p className="text-sm text-jericho-bad">{err}</p>
        </Panel>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Stat label="Profiles" value={overview.profiles} />
        <Stat label="Compliant" value={overview.compliant} />
        <Stat label="Expiring" value={overview.expiring} hint="within warn window" />
        <Stat label="Expired" value={overview.expired} />
        <Stat label="Never trained" value={overview.never} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <span className="rounded-full border border-jericho-border bg-jericho-panel px-3 py-1 text-xs text-jericho-muted">
          expiring ≤30d: <span className="text-jericho-warn font-medium">{forecast.in30}</span>
        </span>
        <span className="rounded-full border border-jericho-border bg-jericho-panel px-3 py-1 text-xs text-jericho-muted">
          expiring ≤60d: <span className="text-jericho-warn font-medium">{forecast.in60}</span>
        </span>
        <span className="rounded-full border border-jericho-border bg-jericho-panel px-3 py-1 text-xs text-jericho-muted">
          expiring ≤90d: <span className="text-jericho-warn font-medium">{forecast.in90}</span>
        </span>
        <span className="rounded-full border border-jericho-border bg-jericho-panel px-3 py-1 text-xs text-jericho-bad">
          already expired: <span className="font-medium">{forecast.expired}</span>
        </span>
      </div>

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">Profiles</h3>
        {profiles.length === 0 ? (
          <p className="text-sm text-jericho-muted">
            No compliance profiles yet.{isAdmin ? " Create one below to start tracking renewal windows." : " An admin can create one to start tracking renewal windows."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Name</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Course</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Renews every</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Warn days</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Auto-reassign</th>
                  <th className="text-left text-xs uppercase tracking-wide text-jericho-muted pb-2">Enabled</th>
                  {isAdmin && <th className="pb-2"></th>}
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-jericho-border/60 text-sm">
                    <td className="py-2 pr-4">{p.name}</td>
                    <td className="py-2 pr-4 text-jericho-muted">
                      <Link href={`/lms/catalog?course=${encodeURIComponent(p.courseLitmosId)}`} className="hover:text-jericho-accent">
                        {courseNameById.get(p.courseLitmosId) ?? p.courseName ?? p.courseLitmosId}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-jericho-muted">{p.renewalMonths} month{p.renewalMonths === 1 ? "" : "s"}</td>
                    <td className="py-2 pr-4 text-jericho-muted">{p.warnDays}</td>
                    <td className="py-2 pr-4">{p.autoReassign ? <span className="text-jericho-good">✓</span> : <span className="text-jericho-muted">—</span>}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={p.enabled ? "low" : "muted"}>{p.enabled ? "enabled" : "disabled"}</Badge>
                    </td>
                    {isAdmin && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <Link href={`/lms/compliance?profile=${encodeURIComponent(p.id)}${statusQS}`} className="text-jericho-accent hover:underline mr-3">
                          edit
                        </Link>
                        <form action={removeProfile} className="inline">
                          <input type="hidden" name="id" value={p.id} />
                          <button className="text-xs text-jericho-muted hover:text-jericho-bad" type="submit">
                            delete
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 border-t border-jericho-border/60 pt-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className="font-medium">{editing ? `Edit profile — ${editing.name}` : "New profile"}</h3>
              {editing && (
                <Link href={listHref} className="text-sm text-jericho-muted hover:text-jericho-text">
                  Cancel
                </Link>
              )}
            </div>
            <form action={saveProfile} className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <label className="block">
                <span className="text-xs text-jericho-muted">Profile name</span>
                <input name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Annual security training" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-xs text-jericho-muted">Course</span>
                <select name="courseLitmosId" required defaultValue={editing?.courseLitmosId ?? ""} className={`mt-1 ${inputCls}`}>
                  <option value="" disabled>
                    Select a course…
                  </option>
                  {editing && !courses.some((c) => c.litmosId === editing.courseLitmosId) && (
                    <option value={editing.courseLitmosId}>{editing.courseName ?? editing.courseLitmosId}</option>
                  )}
                  {courses.map((c) => (
                    <option key={c.litmosId} value={c.litmosId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-jericho-muted">Renews every (months)</span>
                <input name="renewalMonths" type="number" min={1} max={120} required defaultValue={editing?.renewalMonths ?? 12} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="block">
                <span className="text-xs text-jericho-muted">Warn days before expiry</span>
                <input name="warnDays" type="number" min={0} max={365} defaultValue={editing?.warnDays ?? 30} className={`mt-1 ${inputCls}`} />
              </label>
              <div className="md:col-span-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoReassign" value="1" defaultChecked={editing?.autoReassign ?? true} />
                  <span className="text-jericho-muted">Auto-reassign the course when a learner lapses</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" value="1" defaultChecked={editing?.enabled ?? true} />
                  <span className="text-jericho-muted">Enabled</span>
                </label>
                <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                  {editing ? "Save profile" : "Create profile"}
                </button>
              </div>
            </form>
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap gap-2 mb-3">
        <Link href="/lms/compliance" className={chipCls(!status)}>
          all
        </Link>
        {RECORD_STATUSES.map((s) => (
          <Link key={s} href={`/lms/compliance?status=${s}`} className={chipCls(status === s)}>
            {s}
          </Link>
        ))}
      </div>

      {records.length === 0 ? (
        <EmptyState title={status ? `No ${status} records` : "No compliance records yet"}>
          Records appear once a compliance profile exists and learners have assignment history for its course — run a sync, then
          recompute. {status && (
            <Link href="/lms/compliance" className="text-jericho-accent hover:underline">
              Clear the filter
            </Link>
          )}
        </EmptyState>
      ) : (
        <Panel className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-4 py-3 font-medium">Learner</th>
                <th className="px-4 py-3 font-medium">Profile</th>
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Last completed</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const profile = profileById.get(r.profileId);
                const courseId = r.courseLitmosId ?? profile?.courseLitmosId;
                const courseName = (courseId && courseNameById.get(courseId)) ?? profile?.courseName ?? courseId ?? "—";
                const expiresCls = r.status === "expired" ? "text-jericho-bad" : r.status === "expiring" ? "text-jericho-warn" : "text-jericho-muted";
                return (
                  <tr key={r.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-4 py-3">
                      {r.learnerName && <div className="text-jericho-text">{r.learnerName}</div>}
                      <Link href={`/lms/assignments?learner=${encodeURIComponent(r.learnerEmail)}`} className="text-xs text-jericho-muted hover:text-jericho-accent">
                        {r.learnerEmail}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{profile?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-jericho-muted">
                      {courseId ? (
                        <Link href={`/lms/catalog?course=${encodeURIComponent(courseId)}`} className="hover:text-jericho-accent">
                          {courseName}
                        </Link>
                      ) : (
                        courseName
                      )}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{fmtDate(r.lastCompletedAt)}</td>
                    <td className={`px-4 py-3 ${expiresCls}`}>{fmtDate(r.expiresAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={recordTone(r.status)}>{r.status}</Badge>
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
