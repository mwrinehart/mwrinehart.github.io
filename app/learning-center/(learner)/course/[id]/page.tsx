// Course detail: artwork, description, modules, the learner's own status
// (progress, due/compliance), and actions — launch into Litmos (via a fresh
// LoginKey), self-enroll from a team library, and demo-only progress controls
// so the seeded tenant is fully interactive.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLcSession } from "@/lib/modules/learning-center/auth";
import { canSelfEnroll, getSource } from "@/lib/modules/learning-center/source";
import type { DemoLitmosSource } from "@/lib/modules/learning-center/demo";
import { learnerPortalUrl } from "@/lib/modules/learning-center/config";
import { certificateEligible, getCertConfig } from "@/lib/modules/learning-center/certificates";
import { tenantRootId } from "@/lib/modules/learning-center/tenant";
import { Poster } from "@/components/learning-center/Poster";
import { LcBadge, LcProgress, lcBtnPrimary, lcBtnSecondary } from "@/components/learning-center/ui";

function fmt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireLcSession();
  const source = await getSource();

  const details = await source.getCourseDetails(id);
  if (!details) notFound();

  const modules = await source.listCourseModules(id);
  const myCourses = session.litmosUserId ? await source.listUserCourses(session.litmosUserId) : [];
  const mine = myCourses.find((c) => c.Id === id) ?? null;

  // Self-enroll is offered when the course sits in one of the learner's team
  // libraries and isn't already assigned.
  const eligibleToEnroll = session.litmosUserId && !mine ? await canSelfEnroll(source, session.litmosUserId, id) : false;

  // Certificate offered when the learner completed the course and their tenant
  // has certificates enabled for it.
  let showCertificate = false;
  if (session.litmosUserId && mine?.Complete) {
    try {
      const userTeams = await source.listUserTeams(session.litmosUserId);
      const allTeams = await source.listTeams();
      const rootIds = [...new Set(userTeams.map((t) => tenantRootId(allTeams, t.Id)))];
      for (const rootId of rootIds) {
        const config = await getCertConfig(rootId);
        if (certificateEligible(config, { courseId: id })) {
          showCertificate = true;
          break;
        }
      }
    } catch {
      // no certificate
    }
  }

  // Fresh LoginKey per render — it's the working "signed launch link".
  let launchUrl = learnerPortalUrl();
  if (session.litmosUserId) {
    try {
      const detail = await source.getUser(session.litmosUserId);
      if (detail?.LoginKey) launchUrl = detail.LoginKey;
    } catch {
      // fall back to the portal URL
    }
  }

  async function selfEnroll() {
    "use server";
    const s = await requireLcSession();
    if (!s.litmosUserId) redirect(`/learning-center/course/${encodeURIComponent(id)}`);
    const src = await getSource();
    // Re-verify eligibility server-side: the button is only rendered when
    // eligible, but the action is a POST endpoint that must not enroll a
    // learner in an arbitrary course id outside their team libraries.
    if (!(await canSelfEnroll(src, s.litmosUserId, id))) {
      redirect(`/learning-center/course/${encodeURIComponent(id)}`);
    }
    await src.assignCoursesToUser(s.litmosUserId, [id], false);
    revalidatePath(`/learning-center/course/${id}`);
    revalidatePath("/learning-center");
  }

  async function demoStart() {
    "use server";
    const s = await requireLcSession();
    const src = await getSource();
    if (src.mode === "demo" && s.litmosUserId) {
      await (src as DemoLitmosSource).demoStartCourse(s.litmosUserId, id);
    }
    revalidatePath(`/learning-center/course/${id}`);
    revalidatePath("/learning-center");
  }

  async function demoComplete() {
    "use server";
    const s = await requireLcSession();
    const src = await getSource();
    if (src.mode === "demo" && s.litmosUserId) {
      await (src as DemoLitmosSource).demoCompleteCourse(s.litmosUserId, id);
    }
    revalidatePath(`/learning-center/course/${id}`);
    revalidatePath("/learning-center");
  }

  const compliantTill = fmt(mine?.ComplaintTill);
  const now = Date.now();
  const lapsed = mine?.ComplaintTill ? Date.parse(mine.ComplaintTill) < now : false;

  return (
    <main className="mx-auto max-w-5xl px-5 pb-16">
      <div className="pt-6 pb-4">
        <Link href="/learning-center" className="text-sm font-semibold text-lc-purple hover:underline">
          ← Back to Learning Center
        </Link>
      </div>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {details.Tags?.map((t) => (
              <LcBadge key={t} tone="neutral">
                {t}
              </LcBadge>
            ))}
            {!details.Active && <LcBadge tone="ink">Inactive</LcBadge>}
            {details.ComplianceDateSpan != null && <LcBadge tone="purple">Compliance course</LcBadge>}
            {details.Certificate && <LcBadge tone="purple">Certificate</LcBadge>}
          </div>
          <h1 className="text-3xl font-bold text-lc-ink leading-tight">{details.Name}</h1>
          {details.Description && <p className="mt-3 text-sm text-lc-muted leading-relaxed max-w-2xl">{details.Description}</p>}

          {mine && (
            <div className="mt-5 rounded-2xl border border-lc-line p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-2 min-w-44 flex-1">
                  <LcProgress pct={mine.PercentageComplete} className="flex-1" />
                  <span className="font-semibold text-lc-muted text-xs">{Math.round(mine.PercentageComplete)}%</span>
                </div>
                {mine.Complete && <LcBadge tone="purple">Completed {fmt(mine.CompletedDate) ?? ""}</LcBadge>}
                {!mine.Complete && mine.Overdue && <LcBadge tone="amber">Overdue</LcBadge>}
                {compliantTill && <LcBadge tone={lapsed ? "amber" : "neutral"}>{lapsed ? `Compliance lapsed ${compliantTill}` : `Compliant until ${compliantTill}`}</LcBadge>}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {mine ? (
              <>
                <a href={launchUrl} target="_blank" rel="noreferrer" className={lcBtnPrimary}>
                  {mine.Complete ? "Review in Litmos ↗" : mine.PercentageComplete > 0 ? "Continue in Litmos ↗" : "Start in Litmos ↗"}
                </a>
                {source.mode === "demo" && !mine.Complete && (
                  <>
                    {mine.PercentageComplete === 0 && (
                      <form action={demoStart}>
                        <button type="submit" className={lcBtnSecondary}>
                          Demo: start course
                        </button>
                      </form>
                    )}
                    <form action={demoComplete}>
                      <button type="submit" className={lcBtnSecondary}>
                        Demo: mark complete
                      </button>
                    </form>
                  </>
                )}
                {showCertificate && (
                  <a href={`/learning-center/certificate/${encodeURIComponent(id)}`} className={lcBtnSecondary}>
                    🏆 View certificate
                  </a>
                )}
              </>
            ) : eligibleToEnroll ? (
              <form action={selfEnroll}>
                <button type="submit" className={lcBtnPrimary}>
                  Enroll from team library
                </button>
              </form>
            ) : (
              <div className="text-sm text-lc-muted">This course isn&apos;t assigned to you.</div>
            )}
          </div>

          <section className="mt-10">
            <h2 className="text-lg font-bold text-lc-ink mb-3">What&apos;s inside</h2>
            {modules.length ? (
              <ol className="space-y-2">
                {modules.map((m, i) => (
                  <li key={m.Id} className="flex items-center gap-3 rounded-xl border border-lc-line px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lc-tint text-xs font-bold text-lc-purple">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-lc-ink">{m.Name}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-lc-muted">Module list isn&apos;t available for this course.</p>
            )}
          </section>
        </div>

        <div>
          <Poster courseId={details.Id} title={details.Name} tag={details.Tags?.[0]} />
          <dl className="mt-4 space-y-2 rounded-2xl border border-lc-line p-4 text-sm">
            {details.DueDateSpan != null && (
              <div className="flex justify-between gap-4">
                <dt className="text-lc-muted font-medium">Complete within</dt>
                <dd className="font-semibold text-lc-ink">{details.DueDateSpan} days of assignment</dd>
              </div>
            )}
            {details.DueDate && (
              <div className="flex justify-between gap-4">
                <dt className="text-lc-muted font-medium">Due date</dt>
                <dd className="font-semibold text-lc-ink">{fmt(details.DueDate)}</dd>
              </div>
            )}
            {details.ComplianceDateSpan != null && (
              <div className="flex justify-between gap-4">
                <dt className="text-lc-muted font-medium">Certification valid for</dt>
                <dd className="font-semibold text-lc-ink">{details.ComplianceDateSpan} days</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-lc-muted font-medium">Modules</dt>
              <dd className="font-semibold text-lc-ink">{modules.length}</dd>
            </div>
            {details.Code && (
              <div className="flex justify-between gap-4">
                <dt className="text-lc-muted font-medium">Code</dt>
                <dd className="font-semibold text-lc-ink">{details.Code}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </main>
  );
}
