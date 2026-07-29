import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireLcAdmin, signOutLc } from "@/lib/modules/learning-center/auth";
import { isDemoMode } from "@/lib/modules/learning-center/config";
import { AdminShell } from "@/components/learning-center/AdminShell";

export default async function LearningCenterAdminLayout({ children }: { children: ReactNode }) {
  const session = await requireLcAdmin();

  async function signOut() {
    "use server";
    await signOutLc();
    redirect("/learning-center/login");
  }

  return (
    <AdminShell
      email={session.email}
      displayName={session.displayName}
      roleLabel={session.role === "owner" ? "Account owner" : "Team admin"}
      isOwner={session.role === "owner"}
      demoMode={isDemoMode()}
      signOutAction={signOut}
    >
      {children}
    </AdminShell>
  );
}
