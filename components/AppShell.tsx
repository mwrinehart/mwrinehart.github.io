"use client";

// The platform chrome: left sidebar with cross-module navigation, top bar with
// the active org + signed-in user. Client component so the active nav item can be
// highlighted via usePathname. The sign-out server action is passed in from the
// (app) layout (a server component).

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MODULES } from "@/lib/platform/modules";

const PLATFORM_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppShell({
  children,
  userEmail,
  orgName,
  role,
  signOutAction,
}: {
  children: ReactNode;
  userEmail: string;
  orgName: string;
  role: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-jericho-border bg-jericho-panel/60 flex flex-col">
        <div className="px-5 py-5 border-b border-jericho-border">
          <div className="font-semibold text-jericho-text">Jericho Security</div>
          <div className="text-xs text-jericho-muted mt-0.5">Unified Platform</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div className="space-y-1">
            {PLATFORM_LINKS.map((l) => (
              <NavItem key={l.href} href={l.href} active={isActive(l.href)} icon={l.icon} label={l.label} />
            ))}
          </div>

          <div>
            <div className="px-3 text-[11px] uppercase tracking-wider text-jericho-muted mb-2">Modules</div>
            <div className="space-y-1">
              {MODULES.map((m) => (
                <NavItem
                  key={m.id}
                  href={m.href}
                  active={isActive(m.href)}
                  icon={m.icon}
                  label={m.label}
                  badge={m.status !== "live" ? m.status : undefined}
                />
              ))}
            </div>
          </div>
        </nav>

        <div className="px-4 py-3 border-t border-jericho-border text-xs text-jericho-muted">
          <div className="truncate text-jericho-text">{userEmail}</div>
          <div className="truncate">
            {orgName} · {role}
          </div>
          <form action={signOutAction} className="mt-2">
            <button className="text-jericho-accent hover:underline" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-8 py-8">{children}</main>
    </div>
  );
}

function NavItem({
  href,
  active,
  icon,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  icon: string;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-jericho-accent/15 text-jericho-text" : "text-jericho-muted hover:bg-jericho-border/40"
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && <span className="text-[10px] uppercase tracking-wide text-jericho-muted">{badge}</span>}
    </Link>
  );
}
