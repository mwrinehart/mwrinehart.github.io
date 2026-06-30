"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/campaigns/approvals", label: "Approvals" },
  { href: "/campaigns/audit", label: "Audit" },
];

const FIXED = new Set(["/campaigns/approvals", "/campaigns/audit"]);

export function CampaignsNav() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/campaigns") {
      // active on the list page and on a campaign detail page, but not on the
      // other fixed tabs.
      return pathname === "/campaigns" || (pathname.startsWith("/campaigns/") && !FIXED.has(pathname));
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
