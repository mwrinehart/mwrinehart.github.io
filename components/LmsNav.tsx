"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/lms", label: "Library" },
  { href: "/lms/catalog", label: "Catalog" },
  { href: "/lms/learners", label: "Learners" },
  { href: "/lms/teams", label: "Teams" },
  { href: "/lms/assignments", label: "Assignments" },
  { href: "/lms/compliance", label: "Compliance" },
  { href: "/lms/rules", label: "Rules" },
  { href: "/lms/reports", label: "Reports" },
  { href: "/lms/notifications", label: "Notifications" },
  { href: "/lms/settings", label: "Settings" },
];

export function LmsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 mb-6 border-b border-jericho-border">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              active ? "border-jericho-accent text-jericho-text" : "border-transparent text-jericho-muted hover:text-jericho-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
