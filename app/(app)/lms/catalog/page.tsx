import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { createCourse, listLmsCoursesMirror, updateCourse } from "@/lib/modules/lms/catalog";
import { listComplianceProfiles } from "@/lib/modules/lms/compliance";
import { courseGradient } from "@/lib/modules/lms/types";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

const inputCls = "w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString() : "—";
}

export default async function LmsCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = first(sp.q);
  const err = first(sp.error);
  const courseParam = first(sp.course);

  const { orgId } = await requireTenant();
  const [courses, profiles] = await Promise.all([listLmsCoursesMirror(orgId, { q: q || undefined }), listComplianceProfiles(orgId)]);

  const profileNames = new Map<string, string[]>();
  for (const p of profiles) {
    const arr = profileNames.get(p.courseLitmosId) ?? [];
    arr.push(p.name);
    profileNames.set(p.courseLitmosId, arr);
  }

  const editing = courseParam ? courses.find((c) => c.litmosId === courseParam) : undefined;
  const listHref = q ? `/lms/catalog?q=${encodeURIComponent(q)}` : "/lms/catalog";

  async function create(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await createCourse(orgId, {
      name: String(formData.get("name") || ""),
      code: String(formData.get("code") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
    });
    if (!res.ok) redirect(`/lms/catalog?error=${encodeURIComponent(res.error || "Course creation failed")}`);
    revalidatePath("/lms/catalog");
  }

  async function update(formData: FormData) {
    "use server";
    const { orgId } = await requireTenant("member");
    const res = await updateCourse(orgId, String(formData.get("litmosId") || ""), {
      name: String(formData.get("name") || ""),
      code: String(formData.get("code") || "") || undefined,
      description: String(formData.get("description") || "") || undefined,
      active: String(formData.get("active") || "") === "1",
    });
    if (!res.ok) redirect(`/lms/catalog?error=${encodeURIComponent(res.error || "Course update failed")}`);
    revalidatePath("/lms/catalog");
  }

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle="The org's Litmos course catalog, managed from here — no Litmos login needed."
        action={
          <form method="get" className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search name or code…" className={inputCls} />
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

      <Panel className="mb-6">
        <h3 className="font-medium mb-3">New course</h3>
        <form action={create} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-jericho-muted">Name</span>
            <input name="name" required placeholder="Security Awareness 101" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-jericho-muted">Code</span>
            <input name="code" placeholder="SEC-101 (optional)" className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block md:col-span-3">
            <span className="text-xs text-jericho-muted">Description</span>
            <textarea name="description" rows={2} placeholder="Optional description" className={`mt-1 ${inputCls}`} />
          </label>
          <div className="md:col-span-3">
            <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
              Create course
            </button>
          </div>
        </form>
        <p className="text-xs text-jericho-muted mt-2">
          Created directly in Litmos via API, then mirrored here. Course creation requires the Litmos API tier that allows POST /courses —
          errors from Litmos surface verbatim.
        </p>
      </Panel>

      {editing && (
        <Panel className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h3 className="font-medium">Edit course — {editing.name}</h3>
            <Link href={listHref} className="text-sm text-jericho-muted hover:text-jericho-text">
              Cancel
            </Link>
          </div>
          <form action={update} className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="hidden" name="litmosId" value={editing.litmosId} />
            <label className="block">
              <span className="text-xs text-jericho-muted">Name</span>
              <input name="name" required defaultValue={editing.name} className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block">
              <span className="text-xs text-jericho-muted">Code</span>
              <input name="code" defaultValue={editing.code ?? ""} className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block md:col-span-3">
              <span className="text-xs text-jericho-muted">Description</span>
              <textarea name="description" rows={2} defaultValue={editing.description ?? ""} className={`mt-1 ${inputCls}`} />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" name="active" value="1" defaultChecked={editing.active} />
              <span className="text-jericho-muted">Active</span>
            </label>
            <div className="md:col-span-3">
              <button className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90" type="submit">
                Save
              </button>
            </div>
          </form>
          <form action={update} className="mt-3 border-t border-jericho-border/60 pt-3">
            <input type="hidden" name="litmosId" value={editing.litmosId} />
            <input type="hidden" name="name" value={editing.name} />
            <input type="hidden" name="code" value={editing.code ?? ""} />
            <input type="hidden" name="description" value={editing.description ?? ""} />
            <input type="hidden" name="active" value={editing.active ? "0" : "1"} />
            <button
              className={editing.active ? "text-xs text-jericho-muted hover:text-jericho-bad" : "text-xs text-jericho-accent hover:underline"}
              type="submit"
            >
              {editing.active ? "Deactivate course" : "Reactivate course"}
            </button>
          </form>
        </Panel>
      )}

      {courses.length === 0 ? (
        q ? (
          <EmptyState title="No courses match">
            No mirrored course matches “{q}”. <Link href="/lms/catalog" className="text-jericho-accent hover:underline">Clear the search</Link>.
          </EmptyState>
        ) : (
          <EmptyState title="No courses in the mirror yet">
            Run a sync from <Link href="/lms/settings" className="text-jericho-accent hover:underline">LMS settings</Link> to pull the Litmos
            catalog, or create a course above.
          </EmptyState>
        )
      ) : (
        <Panel className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-jericho-muted border-b border-jericho-border">
              <tr>
                <th className="px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Compliance</th>
                <th className="px-4 py-3 font-medium">Enrolled / done</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Synced</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const g = courseGradient(c.litmosId);
                const profiled = profileNames.get(c.litmosId);
                const editHref = `/lms/catalog?course=${encodeURIComponent(c.litmosId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
                return (
                  <tr key={c.id} className="border-b border-jericho-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="h-6 w-10 rounded" style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-jericho-text">{c.name}</div>
                      {c.description && <div className="text-xs text-jericho-muted line-clamp-1 max-w-xs">{c.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{c.code || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={c.source === "studio" ? "low" : "muted"}>{c.source}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {profiled ? (
                        <span title={`Compliance profile${profiled.length > 1 ? "s" : ""}: ${profiled.join(", ")}`}>🛡</span>
                      ) : (
                        <span className="text-jericho-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">
                      {c.enrolledCount} / {c.completedCount}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={c.active ? "low" : "muted"}>{c.active ? "active" : "inactive"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-jericho-muted">{fmtDate(c.syncedAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={editHref} className="text-jericho-accent hover:underline mr-3">
                        edit
                      </Link>
                      <Link href={`/lms/assignments?course=${encodeURIComponent(c.litmosId)}`} className="text-jericho-accent hover:underline">
                        assign
                      </Link>
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
