// Learning Center presentational primitives — the light-themed, Jericho-branded
// counterpart of components/ui.tsx (which is platform-dark). No hooks; all
// server-component safe. Palette discipline: purple is primary, orange is THE
// single accent (alerts/highlights), everything else is ink/tint/white.

import type { ReactNode } from "react";

export const lcInputCls =
  "rounded-lg border border-lc-line bg-white px-3 py-2 text-sm text-lc-ink outline-none focus:border-lc-purple w-full";
export const lcSelectCls = lcInputCls;
export const lcBtnPrimary =
  "rounded-lg bg-lc-purple px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer";
export const lcBtnSecondary =
  "rounded-lg border border-lc-line bg-white px-3.5 py-2 text-sm font-semibold text-lc-ink hover:bg-lc-tint cursor-pointer";
export const lcBtnDanger =
  "rounded-lg border border-lc-amber/60 bg-white px-3.5 py-2 text-sm font-semibold text-lc-ink hover:bg-lc-amber/10 cursor-pointer";
export const lcBtnGhost = "rounded-lg px-2.5 py-1.5 text-xs font-semibold text-lc-purple hover:bg-lc-tint cursor-pointer";

export function LcPageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-lc-ink">{title}</h1>
        {subtitle && <p className="text-sm text-lc-muted mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function LcPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Only emit the default white background when the caller hasn't supplied one:
  // two equal-specificity `bg-*` utilities resolve by stylesheet order, not by
  // class-attribute order, so a hardcoded `bg-white` here can silently defeat a
  // `bg-lc-purple`/`bg-lc-tint` passed in className (leaving e.g. white text on
  // a white card).
  const hasBg = /(^|\s)bg-/.test(className);
  return <div className={`rounded-2xl border border-lc-line p-5 ${hasBg ? "" : "bg-white"} ${className}`}>{children}</div>;
}

export function LcStat({ label, value, hint, alert = false }: { label: string; value: ReactNode; hint?: string; alert?: boolean }) {
  return (
    <LcPanel className={alert ? "bg-lc-tint" : ""}>
      <div className="text-xs font-semibold uppercase tracking-wide text-lc-muted">{label}</div>
      <div className={`text-3xl font-bold mt-2 ${alert ? "text-lc-amber" : "text-lc-ink"}`}>{value}</div>
      {hint && <div className="text-xs text-lc-muted mt-1">{hint}</div>}
    </LcPanel>
  );
}

// Tones: "purple" (good/complete/primary), "amber" (needs attention — the one
// sparing accent), "ink" (informational), default neutral.
const LC_BADGE_STYLES: Record<string, string> = {
  purple: "bg-lc-purple/10 text-lc-purple",
  amber: "bg-lc-amber/15 text-[#9a6a00]",
  ink: "bg-lc-ink/10 text-lc-ink",
  neutral: "bg-lc-tint text-lc-muted",
};

export function LcBadge({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${LC_BADGE_STYLES[tone] ?? LC_BADGE_STYLES.neutral}`}>
      {children}
    </span>
  );
}

export function LcEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <LcPanel className="text-center py-12 bg-lc-tint border-lc-tint">
      <div className="text-lc-ink font-semibold">{title}</div>
      {children && <div className="text-sm text-lc-muted mt-2 max-w-md mx-auto">{children}</div>}
    </LcPanel>
  );
}

export function LcProgress({ pct, className = "" }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={`h-1.5 rounded-full bg-lc-ink/10 overflow-hidden ${className}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-lc-purple" style={{ width: `${clamped}%` }} />
    </div>
  );
}

// Flash messages surfaced via ?ok= / ?error= after server actions.
export function LcFlash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${error ? "bg-lc-amber/15 text-lc-ink" : "bg-lc-purple/10 text-lc-purple"}`}>
      {error ?? ok}
    </div>
  );
}

// Standard table wrapper (light theme).
export function LcTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <LcPanel className="p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-lc-muted border-b border-lc-line [&>th]:px-4 [&>th]:py-3 [&>th]:font-semibold">{head}</tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-lc-line [&>tr:last-child]:border-0 [&>tr>td]:px-4 [&>tr>td]:py-3">{children}</tbody>
      </table>
    </LcPanel>
  );
}
