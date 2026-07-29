"use client";

// Netflix-style horizontally scrolling row with edge-arrow paging. Cards are
// rendered server-side and passed as children; this component only owns the
// scroll behavior, so it stays tiny.

import { useRef, type ReactNode } from "react";

export function CourseRow({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <section className="mb-9">
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h2 className="text-lg font-bold text-lc-ink">{title}</h2>
          {subtitle && <p className="text-xs text-lc-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="hidden md:flex gap-1.5">
          <button
            type="button"
            onClick={() => page(-1)}
            aria-label={`Scroll ${title} left`}
            className="h-8 w-8 rounded-full border border-lc-line bg-white text-lc-ink hover:bg-lc-tint cursor-pointer"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => page(1)}
            aria-label={`Scroll ${title} right`}
            className="h-8 w-8 rounded-full border border-lc-line bg-white text-lc-ink hover:bg-lc-tint cursor-pointer"
          >
            ›
          </button>
        </div>
      </div>
      <div ref={scroller} className="lc-row-scroll flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1 px-1">
        {children}
      </div>
    </section>
  );
}
