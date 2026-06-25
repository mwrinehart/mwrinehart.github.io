"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/compliance", label: "Findings" },
  { href: "/compliance/feeds", label: "Feeds" },
  { href: "/compliance/policies", label: "Policies" },
  { href: "/compliance/keywords", label: "Keywords" },
  { href: "/compliance/alerts", label: "Alerts" },
];

export function ComplianceNav() {
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
