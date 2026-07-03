"use client";

// Netflix-style horizontal course row: snap-scrolling cards with deterministic
// gradient "cover art", hover zoom, and quick actions. Client-only for the
// arrow-button scrolling; data arrives as plain serializable props.

import Link from "next/link";
import { useRef } from "react";
import { courseGradient, courseInitials } from "@/lib/modules/lms/types";

export interface CarouselCourse {
  litmosId: string;
  name: string;
  code?: string | null;
  source?: string | null;
  enrolled?: number;
  completed?: number;
  overdue?: number;
  tag?: string | null;
}

export function CourseCarousel({ title, courses, emptyHint }: { title: string; courses: CarouselCourse[]; emptyHint?: string }) {
  const scroller = useRef<HTMLDivElement>(null);

  if (!courses.length) {
    if (!emptyHint) return null;
    return (
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">{title}</h2>
        <p className="text-sm text-jericho-muted">{emptyHint}</p>
      </section>
    );
  }

  const nudge = (dir: 1 | -1) => {
    scroller.current?.scrollBy({ left: dir * (scroller.current.clientWidth - 120), behavior: "smooth" });
  };

  return (
    <section className="mb-8 group/row">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label={`Scroll ${title} left`}
            onClick={() => nudge(-1)}
            className="rounded-full border border-jericho-border w-8 h-8 text-jericho-muted hover:text-jericho-text hover:border-jericho-accent"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={`Scroll ${title} right`}
            onClick={() => nudge(1)}
            className="rounded-full border border-jericho-border w-8 h-8 text-jericho-muted hover:text-jericho-text hover:border-jericho-accent"
          >
            ›
          </button>
        </div>
      </div>
      <div
        ref={scroller}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {courses.map((c) => (
          <CourseCard key={c.litmosId} course={c} />
        ))}
      </div>
    </section>
  );
}

function CourseCard({ course }: { course: CarouselCourse }) {
  const g = courseGradient(course.litmosId);
  const rate = course.enrolled ? Math.round(((course.completed ?? 0) / course.enrolled) * 100) : null;
  return (
    <div className="snap-start shrink-0 w-60 group/card">
      <div className="relative rounded-xl overflow-hidden border border-jericho-border transition-transform duration-200 group-hover/card:scale-[1.04] group-hover/card:border-jericho-accent group-hover/card:shadow-lg group-hover/card:shadow-black/40">
        <div className="aspect-video flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}>
          <span className="text-3xl font-bold text-white/80 tracking-wider select-none">{courseInitials(course.name)}</span>
          {course.tag && (
            <span className="absolute top-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/90">{course.tag}</span>
          )}
          {course.source === "studio" && (
            <span className="absolute top-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/90">🎬 Studio</span>
          )}
          {/* Hover overlay: quick stats + actions */}
          <div className="absolute inset-0 bg-black/70 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
            <div className="text-[11px] text-white/80">
              {course.enrolled ?? 0} enrolled{rate !== null ? ` · ${rate}% complete` : ""}
              {course.overdue ? <span className="text-jericho-bad"> · {course.overdue} overdue</span> : null}
            </div>
            <div className="flex gap-2">
              <Link
                href={`/lms/assignments?course=${encodeURIComponent(course.litmosId)}`}
                className="rounded bg-white text-black px-2.5 py-1 text-xs font-semibold hover:opacity-90"
              >
                ▶ Assign
              </Link>
              <Link
                href={`/lms/catalog?course=${encodeURIComponent(course.litmosId)}`}
                className="rounded border border-white/40 text-white px-2.5 py-1 text-xs hover:bg-white/10"
              >
                Details
              </Link>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-sm font-medium truncate" title={course.name}>{course.name}</div>
        {course.code && <div className="text-[11px] text-jericho-muted truncate">{course.code}</div>}
      </div>
    </div>
  );
}
