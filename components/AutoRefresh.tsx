"use client";

// Polls router.refresh() while `active` — used by the Agents module so a page
// keeps re-rendering server data while an agent reply is streaming in, without
// any client-side data fetching of its own.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ active, intervalMs = 2000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
