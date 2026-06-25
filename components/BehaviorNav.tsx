"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/behavior", label: "Overview" },
  { href: "/behavior/risk", label: "Risk scores" },
  { href: "/behavior/behaviors", label: "Behaviors" },
  { href: "/behavior/pulse", label: "Threat Pulse" },
  { href: "/behavior/nudges", label: "Nudges" },
  { href: "/behavior/sources", label: "Sources" },
];

export function BehaviorNav() {
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
              active
                ? "border-jericho-accent text-jericho-text"
                : "border-transparent text-jericho-muted hover:text-jericho-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
