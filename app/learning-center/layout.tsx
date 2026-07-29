import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Jericho Security Learning Center",
  description: "Security awareness training for your team — powered by the Jericho Security Learning Center.",
};

// Standalone light-themed app inside the dark platform: everything under
// /learning-center renders in the Jericho brand palette with DM Sans. Auth is
// enforced by the learner/admin sub-layouts, not here (login is public).
export default function LearningCenterLayout({ children }: { children: ReactNode }) {
  return <div className="lc-app font-lc min-h-screen bg-white text-lc-ink">{children}</div>;
}
