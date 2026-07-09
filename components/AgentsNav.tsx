"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/agents", label: "Fleet" },
  { href: "/agents/broadcast", label: "Broadcast" },
];

const FIXED = new Set(["/agents/broadcast"]);

export function AgentsNav() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/agents") {
      // active on the fleet page and on a device chat page, but not on the
      // other fixed tabs.
      return pathname === "/agents" || (pathname.startsWith("/agents/") && !FIXED.has(pathname));
    }
    return pathname === href;
  };
  return (
    <nav className="flex flex-wrap gap-1 mb-6 border-b border-jericho-border">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            isActive(t.href) ? "border-jericho-accent text-jericho-text" : "border-transparent text-jericho-muted hover:text-jericho-text"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
