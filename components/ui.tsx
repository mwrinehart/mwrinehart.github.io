// Small presentational primitives shared across modules. No hooks, so they work
// in server components. The eventual real design system replaces these, but they
// give every module a consistent look from day one.

import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-jericho-text">{title}</h1>
        {subtitle && <p className="text-sm text-jericho-muted mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-jericho-border bg-jericho-panel p-5 ${className}`}>{children}</div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Panel>
      <div className="text-xs uppercase tracking-wide text-jericho-muted">{label}</div>
      <div className="text-3xl font-semibold mt-2 text-jericho-text">{value}</div>
      {hint && <div className="text-xs text-jericho-muted mt-1">{hint}</div>}
    </Panel>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-jericho-good/15 text-jericho-good",
  medium: "bg-jericho-warn/15 text-jericho-warn",
  high: "bg-jericho-bad/15 text-jericho-bad",
  critical: "bg-jericho-bad/25 text-jericho-bad",
};

export function Badge({ tone = "medium", children }: { tone?: string; children: ReactNode }) {
  const style = SEVERITY_STYLES[tone] ?? "bg-jericho-border text-jericho-muted";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Panel className="text-center py-12">
      <div className="text-jericho-text font-medium">{title}</div>
      {children && <div className="text-sm text-jericho-muted mt-2 max-w-md mx-auto">{children}</div>}
    </Panel>
  );
}
