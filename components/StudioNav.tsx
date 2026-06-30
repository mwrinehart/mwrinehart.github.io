"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/studio", label: "Courses" },
  { href: "/studio/media", label: "Media" },
];

export function StudioNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/studio" ? pathname === "/studio" || (pathname.startsWith("/studio/") && pathname !== "/studio/media") : pathname === href;
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
