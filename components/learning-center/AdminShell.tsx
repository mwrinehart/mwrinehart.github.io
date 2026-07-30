"use client";

// Team-admin dashboard chrome: fixed sidebar (logo icon top-left per brand
// rules), section nav, and the signed-in identity block. Client component for
// usePathname active states; sign-out is a server action passed in as a form
// action (same pattern as the platform AppShell).

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface AdminNavItem {
  href: string;
  label: string;
}

interface NavGroup {
  heading: string | null;
  items: AdminNavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [{ href: "/learning-center/admin", label: "Overview" }],
  },
  {
    heading: "People & training",
    items: [
      { href: "/learning-center/admin/users", label: "Users" },
      { href: "/learning-center/admin/assignments", label: "Assignments" },
      { href: "/learning-center/admin/due-dates", label: "Due dates" },
      { href: "/learning-center/admin/compliance", label: "Compliance" },
      { href: "/learning-center/admin/library", label: "Course library" },
      { href: "/learning-center/admin/rules", label: "Rules" },
    ],
  },
  {
    heading: "Engagement",
    items: [
      { href: "/learning-center/admin/gamification", label: "Gamification" },
      { href: "/learning-center/admin/leaderboards", label: "Leaderboards" },
      { href: "/learning-center/admin/certificates", label: "Certificates" },
    ],
  },
  {
    heading: "Tenant setup",
    items: [
      { href: "/learning-center/admin/branding", label: "Branding" },
      { href: "/learning-center/admin/notifications", label: "Notifications" },
      { href: "/learning-center/admin/email", label: "Email (SMTP)" },
      { href: "/learning-center/admin/api", label: "API access" },
    ],
  },
  {
    heading: "Records",
    items: [
      { href: "/learning-center/admin/reports", label: "Reports" },
      { href: "/learning-center/admin/audit", label: "Audit log" },
    ],
  },
];

export function AdminShell({
  children,
  email,
  displayName,
  roleLabel,
  isOwner,
  demoMode,
  signOutAction,
}: {
  children: ReactNode;
  email: string;
  displayName: string;
  roleLabel: string;
  isOwner: boolean;
  demoMode: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  // Owner-only "Settings" lives in the Tenant setup group.
  const groups = NAV_GROUPS.map((g) =>
    g.heading === "Tenant setup" && isOwner
      ? { ...g, items: [...g.items, { href: "/learning-center/admin/settings", label: "Settings" }] }
      : g,
  );

  return (
    <div className="lc-app font-lc min-h-screen bg-lc-tint text-lc-ink flex">
      <aside className="w-64 shrink-0 border-r border-lc-line bg-white px-4 py-5 flex flex-col sticky top-0 h-screen overflow-y-auto">
        <Link href="/learning-center" className="flex items-center gap-2.5 px-2 mb-6">
          <Image src="/learning-center/logo-icon.png" alt="Jericho Security" width={28} height={28} unoptimized />
          <span className="leading-tight">
            <span className="block text-sm font-bold text-lc-ink">Learning Center</span>
            <span className="block text-[11px] font-semibold text-lc-purple">Team Admin</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-4">
          {groups.map((group) => (
            <div key={group.heading ?? "top"} className="space-y-0.5">
              {group.heading && <div className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-lc-muted">{group.heading}</div>}
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/learning-center/admin" && pathname.startsWith(item.href + "/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-lc-purple text-white" : "text-lc-ink hover:bg-lc-tint"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="mt-6 border-t border-lc-line pt-4 px-1">
          {demoMode && (
            <div className="mb-3 rounded-lg bg-lc-amber/15 px-3 py-2 text-[11px] font-semibold text-lc-ink">
              Demo mode — seeded tenant, no Litmos key configured.
            </div>
          )}
          <div className="text-sm font-semibold text-lc-ink truncate">{displayName}</div>
          <div className="text-xs text-lc-muted truncate">{email}</div>
          <div className="text-[11px] font-semibold text-lc-purple mt-0.5">{roleLabel}</div>
          <div className="mt-3 flex items-center gap-2">
            <Link href="/learning-center" className="text-xs font-semibold text-lc-purple hover:underline">
              Learner view
            </Link>
            <span className="text-lc-line">·</span>
            <form action={signOutAction}>
              <button type="submit" className="text-xs font-semibold text-lc-muted hover:text-lc-ink cursor-pointer">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-6 py-7 lg:px-10">{children}</main>
    </div>
  );
}
