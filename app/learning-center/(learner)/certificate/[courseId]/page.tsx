// Print-ready completion certificate for the signed-in learner. Only rendered
// when the learner has actually completed the course and the tenant has
// certificates enabled for it — otherwise it redirects back. Styled for
// clean printing (the browser's Print dialog produces a PDF).

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireLcSession } from "@/lib/modules/learning-center/auth";
import { getSource } from "@/lib/modules/learning-center/source";
import { certificateEligible, getCertConfig } from "@/lib/modules/learning-center/certificates";
import { brandingForUserTeams, tenantRootId } from "@/lib/modules/learning-center/tenant";
import { PrintButton } from "@/components/learning-center/PrintButton";

function fmt(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function CertificatePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const session = await requireLcSession();
  if (!session.litmosUserId) redirect("/learning-center");
  const source = await getSource();

  const [details, myCourses, userTeams, allTeams] = await Promise.all([
    source.getCourseDetails(courseId),
    source.listUserCourses(session.litmosUserId),
    source.listUserTeams(session.litmosUserId),
    source.listTeams(),
  ]);
  if (!details) notFound();
  const mine = myCourses.find((c) => c.Id === courseId);
  if (!mine?.Complete) redirect(`/learning-center/course/${encodeURIComponent(courseId)}`);

  // Certificate config comes from the learner's tenant root.
  const rootIds = [...new Set(userTeams.map((t) => tenantRootId(allTeams, t.Id)))];
  let config = null;
  for (const rootId of rootIds) {
    const c = await getCertConfig(rootId);
    if (c?.enabled) {
      config = c;
      break;
    }
  }
  if (!certificateEligible(config, { courseId })) redirect(`/learning-center/course/${encodeURIComponent(courseId)}`);

  const branding = await brandingForUserTeams(allTeams, userTeams);
  const orgName = branding?.portalName || "Jericho Security";
  const learnerName = session.displayName;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 print:py-0">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href={`/learning-center/course/${encodeURIComponent(courseId)}`} className="text-sm font-semibold text-lc-purple hover:underline">
          ← Back to course
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-2xl border-[6px] border-lc-purple/25 bg-white p-10 sm:p-16 text-center print:border-lc-purple/40 print:rounded-none">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lc-purple">{orgName}</div>
        <div className="mt-8 text-3xl sm:text-4xl font-bold text-lc-ink">{config?.titleText ?? "Certificate of Completion"}</div>
        <div className="mt-8 text-sm text-lc-muted">This certifies that</div>
        <div className="mt-2 text-2xl sm:text-3xl font-bold text-lc-ink">{learnerName}</div>
        <div className="mt-4 text-sm text-lc-muted">{config?.messageText ?? "has successfully completed"}</div>
        <div className="mt-1 text-xl font-semibold text-lc-purple">{details.Name}</div>
        {typeof mine.PercentageComplete === "number" && (
          <div className="mt-2 text-xs text-lc-muted">Completed {fmt(mine.CompletedDate)}</div>
        )}

        <div className="mt-14 flex items-end justify-between gap-8">
          <div className="text-left text-xs text-lc-muted">
            <div className="border-t border-lc-ink/40 pt-1.5 w-44 font-semibold text-lc-ink">{config?.signerName || orgName}</div>
            <div>{config?.signerTitle || "Training"}</div>
          </div>
          <div className="text-right text-xs text-lc-muted">
            <div className="border-t border-lc-ink/40 pt-1.5 w-40">{fmt(mine.CompletedDate)}</div>
            <div>Date</div>
          </div>
        </div>
      </div>
    </main>
  );
}
