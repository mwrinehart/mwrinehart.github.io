// Course poster artwork — flat, generated from the Jericho logo's own rounded
// geometry (arch + quarter-circle), no photography and no gradients per the
// design system. Variant is deterministic per course id so the catalog looks
// designed, not random. Orange appears in exactly one variant, as an accent.

import type { ReactNode } from "react";

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Variant {
  bg: string;
  text: string;
  chip: string;
  shapes: ReactNode;
}

const VARIANTS: Array<(key: number) => Variant> = [
  // Purple field, white geometry
  () => ({
    bg: "#6119E5",
    text: "#FFFFFF",
    chip: "rgba(255,255,255,0.22)",
    shapes: (
      <>
        <path d="M 320 180 L 320 60 A 60 60 0 0 0 260 120 L 260 180 Z" fill="#FFFFFF" opacity="0.16" />
        <circle cx="292" cy="34" r="46" fill="#FFFFFF" opacity="0.1" />
      </>
    ),
  }),
  // Tint field, purple geometry (kept clear of the bottom-left title zone)
  () => ({
    bg: "#F4F2FB",
    text: "#312956",
    chip: "rgba(97,25,229,0.12)",
    shapes: (
      <>
        <path d="M 320 0 L 320 84 A 84 84 0 0 1 236 0 Z" fill="#6119E5" opacity="0.9" />
        <path d="M 320 180 L 320 120 A 60 60 0 0 0 260 180 Z" fill="#6119E5" opacity="0.16" />
      </>
    ),
  }),
  // Ink field, purple arch + the single amber accent
  () => ({
    bg: "#312956",
    text: "#FFFFFF",
    chip: "rgba(255,255,255,0.18)",
    shapes: (
      <>
        <path d="M 252 180 L 252 92 A 44 44 0 0 1 296 48 L 296 180 Z" fill="#6119E5" />
        <path d="M 320 180 L 320 132 A 48 48 0 0 0 272 180 Z" fill="#F4A301" />
      </>
    ),
  }),
  // White field, tint block + purple quarter-circle
  () => ({
    bg: "#FFFFFF",
    text: "#312956",
    chip: "rgba(97,25,229,0.1)",
    shapes: (
      <>
        <rect x="220" y="0" width="100" height="180" fill="#F4F2FB" />
        <path d="M 320 180 L 320 110 A 70 70 0 0 0 250 180 Z" fill="#6119E5" opacity="0.8" />
      </>
    ),
  }),
];

export function coursePosterVariant(courseId: string): number {
  return hashCode(courseId) % VARIANTS.length;
}

export function Poster({
  courseId,
  title,
  tag,
  footer,
  className = "",
}: {
  courseId: string;
  title: string;
  tag?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const v = VARIANTS[coursePosterVariant(courseId)](hashCode(courseId));
  return (
    <div
      className={`relative w-full aspect-video overflow-hidden rounded-xl border border-lc-line ${className}`}
      style={{ backgroundColor: v.bg }}
    >
      <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {v.shapes}
      </svg>
      <div className="absolute inset-0 flex flex-col justify-between p-3.5">
        {tag ? (
          <span
            className="self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
            style={{ backgroundColor: v.chip, color: v.text }}
          >
            {tag}
          </span>
        ) : (
          <span />
        )}
        <div>
          <div className="text-base font-bold leading-snug line-clamp-3 pr-14" style={{ color: v.text }}>
            {title}
          </div>
          {footer && <div className="mt-1.5">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
