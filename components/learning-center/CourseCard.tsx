// A poster card in a learner row. Server component — the whole card is a link
// to the course page.

import Link from "next/link";
import { Poster } from "./Poster";
import { LcProgress } from "./ui";

export function CourseCard({
  courseId,
  title,
  tag,
  pct,
  chip,
  chipTone = "neutral",
}: {
  courseId: string;
  title: string;
  tag?: string;
  pct?: number;
  chip?: string;
  chipTone?: "purple" | "amber" | "ink" | "neutral";
}) {
  const chipStyles: Record<string, string> = {
    purple: "bg-lc-purple text-white",
    amber: "bg-lc-amber text-lc-ink",
    ink: "bg-lc-ink text-white",
    neutral: "bg-white/90 text-lc-ink border border-lc-line",
  };
  return (
    <Link
      href={`/learning-center/course/${encodeURIComponent(courseId)}`}
      className="group w-60 md:w-72 shrink-0 snap-start"
    >
      <div className="relative transition-transform duration-150 group-hover:-translate-y-1">
        <Poster courseId={courseId} title={title} tag={tag} />
        {chip && (
          <span className={`absolute top-2.5 right-2.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chipStyles[chipTone]}`}>
            {chip}
          </span>
        )}
      </div>
      {typeof pct === "number" && pct > 0 && pct < 100 ? (
        <div className="mt-2 flex items-center gap-2 px-0.5">
          <LcProgress pct={pct} className="flex-1" />
          <span className="text-[11px] font-semibold text-lc-muted">{Math.round(pct)}%</span>
        </div>
      ) : (
        <div className="mt-2 h-1.5" />
      )}
    </Link>
  );
}
