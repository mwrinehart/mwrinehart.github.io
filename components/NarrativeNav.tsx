"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/narrative", label: "Overview" },
  { href: "/narrative/alerts", label: "Alerts" },
  { href: "/narrative/responses", label: "Responses" },
  { href: "/narrative/sources", label: "Sources" },
  { href: "/narrative/facts", label: "Facts" },
  { href: "/narrative/audit", label: "Audit" },
];

export function NarrativeNav() {
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
