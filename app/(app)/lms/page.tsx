// The Library — Netflix-style front door for the LMS module. Everything renders
// from the local Litmos mirror, so the page is fast and works even while Litmos
// is down; the only network write is the admin "Sync now" action.

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/platform/org";
import { listLmsCoursesMirror } from "@/lib/modules/lms/catalog";
import { completionByCourse } from "@/lib/modules/lms/reports";
import { listComplianceProfiles } from "@/lib/modules/lms/compliance";
import { getLmsSettings } from "@/lib/modules/lms/notifications";
import { listLmsSyncRuns, lmsConfigured, syncLmsOrg } from "@/lib/modules/lms/sync";
import { courseGradient } from "@/lib/modules/lms/types";
import type { LmsCourseRow } from "@/lib/modules/lms/schema";
import { CourseCarousel, type CarouselCourse } from "@/components/lms/CourseCarousel";
import { EmptyState, PageHeader, Panel } from "@/components/ui";

const DAY_MS = 86_400_000;

export default async function LmsLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const errorMsg = typeof sp.error === "string" ? sp.error : "";
  const { orgId, role } = await requireTenant();
  const isAdmin = role === "admin" || role === "owner";

  const [courses, completion, profiles, settings, configured, runs] = await Promise.all([
    listLmsCoursesMirror(orgId, { activeOnly: true }),
    completionByCourse(orgId),
    listComplianceProfiles(orgId),
    getLmsSettings(orgId),
    lmsConfigured(orgId),
    listLmsSyncRuns(orgId, 1),
  ]);

  async function syncNow() {
    "use server";
    const { orgId } = await requireTenant("admin");
    let failure = "";
    try {
      await syncLmsOrg(orgId);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    revalidatePath("/lms");
    if (failure) redirect(`/lms?error=${encodeURIComponent(failure)}`);
  }

  if (!configured) {
    return (
      <EmptyState title="Connect Litmos to light up the library">
        Add your Litmos API credentials in{" "}
        <Link href="/lms/settings" className="text-jericho-accent hover:underline">
          LMS settings
        </Link>{" "}
        to sync your catalog, learners, and teams. Notification channels (Slack, Teams, Google Chat, email) live under
        Settings → Integrations.
      </EmptyState>
    );
  }

  const lastRun = runs[0];
  const syncedLabel = lastRun ? `Synced ${new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString()}` : "Never synced";

  const header = (
    <PageHeader
      title="Library"
      subtitle="Your Litmos catalog — browse, feature, and assign without leaving here."
      action={
        <div className="flex items-center gap-2">
          <span className="text-xs text-jericho-muted whitespace-nowrap">{syncedLabel}</span>
          {isAdmin && (
            <form action={syncNow}>
              <button
                type="submit"
                className="rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40 whitespace-nowrap"
              >
                Sync now
              </button>
            </form>
          )}
        </div>
      }
    />
  );

  const errorPanel = errorMsg ? (
    <Panel className="mb-6">
      <p className="text-sm text-jericho-bad">{errorMsg}</p>
    </Panel>
  ) : null;

  if (!courses.length) {
    return (
      <>
        {header}
        {errorPanel}
        <EmptyState title="No courses in the library yet">
          <p>Litmos is connected but nothing has been mirrored. Run a sync to pull in your catalog.</p>
          {isAdmin && (
            <form action={syncNow} className="mt-4">
              <button type="submit" className="rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                Sync now
              </button>
            </form>
          )}
        </EmptyState>
      </>
    );
  }

  // ── row assembly (all pure lookups against the mirror + completion rollup) ──

  const statsByCourse = new Map(completion.map((c) => [c.courseId, c]));
  const openOf = (litmosId: string): number => {
    const s = statsByCourse.get(litmosId);
    return s ? s.assigned - s.completed : 0;
  };
  const overdueOf = (litmosId: string): number => statsByCourse.get(litmosId)?.overdue ?? 0;

  const toCard = (c: LmsCourseRow, tag?: string | null): CarouselCourse => {
    const s = statsByCourse.get(c.litmosId);
    return {
      litmosId: c.litmosId,
      name: c.name,
      code: c.code,
      source: c.source,
      enrolled: s?.assigned ?? 0,
      completed: s?.completed ?? 0,
      overdue: s?.overdue ?? 0,
      tag: tag ?? null,
    };
  };

  let featured = settings.featuredCourseId ? courses.find((c) => c.litmosId === settings.featuredCourseId) : undefined;
  if (!featured) {
    const busiest = [...courses].sort((a, b) => openOf(b.litmosId) - openOf(a.litmosId))[0];
    featured = openOf(busiest.litmosId) > 0 ? busiest : courses[0];
  }
  const featuredStats = statsByCourse.get(featured.litmosId);
  const gradient = courseGradient(featured.litmosId);

  const inProgress = courses
    .filter((c) => openOf(c.litmosId) > 0)
    .sort((a, b) => openOf(b.litmosId) - openOf(a.litmosId))
    .map((c) => toCard(c));

  const needsAttention = courses
    .filter((c) => overdueOf(c.litmosId) > 0)
    .sort((a, b) => overdueOf(b.litmosId) - overdueOf(a.litmosId))
    .map((c) => toCard(c, "overdue"));

  const complianceCourseIds = new Set(profiles.map((p) => p.courseLitmosId));
  const complianceEssentials = courses.filter((c) => complianceCourseIds.has(c.litmosId)).map((c) => toCard(c, "compliance"));

  const fromStudio = courses.filter((c) => c.source === "studio").map((c) => toCard(c));

  const now = Date.now();
  const recentlyAdded = [...courses]
    .sort((a, b) => (b.litmosCreatedAt ?? b.createdAt) - (a.litmosCreatedAt ?? a.createdAt))
    .slice(0, 12)
    .map((c) => toCard(c, now - (c.litmosCreatedAt ?? c.createdAt) <= 30 * DAY_MS ? "new" : null));

  const everything = [...courses].sort((a, b) => a.name.localeCompare(b.name)).map((c) => toCard(c));

  return (
    <>
      {header}
      {errorPanel}

      {/* ── hero billboard ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden min-h-[340px] flex flex-col justify-end mb-10"
        style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative p-8">
          <div className="text-[11px] uppercase tracking-widest text-white/60 mb-2">Featured · {featured.code || "Course"}</div>
          <h2 className="text-4xl md:text-5xl font-bold text-white max-w-2xl">{featured.name}</h2>
          {featured.description && <p className="mt-3 text-sm text-white/70 max-w-xl line-clamp-2">{featured.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">{featuredStats?.assigned ?? 0} enrolled</span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">{featuredStats?.completionRate ?? 0}% complete</span>
            <span className={`rounded-full bg-white/10 px-3 py-1 ${(featuredStats?.overdue ?? 0) > 0 ? "text-jericho-bad" : "text-white/80"}`}>
              {featuredStats?.overdue ?? 0} overdue
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/lms/assignments?course=${encodeURIComponent(featured.litmosId)}`}
              className="rounded-lg bg-white text-black px-5 py-2.5 text-sm font-semibold hover:opacity-90"
            >
              ▶ Assign now
            </Link>
            <Link
              href={`/lms/catalog?course=${encodeURIComponent(featured.litmosId)}`}
              className="rounded-lg border border-white/40 text-white px-5 py-2.5 text-sm font-medium hover:bg-white/10"
            >
              More info
            </Link>
          </div>
        </div>
      </div>

      {/* ── rows ── */}
      <CourseCarousel title="Continue the rollout" courses={inProgress} />
      <CourseCarousel title="Needs attention" courses={needsAttention} />
      <CourseCarousel title="Compliance essentials" courses={complianceEssentials} />
      <CourseCarousel
        title="Fresh from Content Studio"
        courses={fromStudio}
        emptyHint="Publish a Studio course to Litmos and it lands here."
      />
      <CourseCarousel title="Recently added" courses={recentlyAdded} />
      <CourseCarousel title="Everything A–Z" courses={everything} />
    </>
  );
}
