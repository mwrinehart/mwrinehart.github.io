import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { auth, signOut } from "@/lib/platform/auth";
import { getActiveOrgId, listOrgsForUser } from "@/lib/platform/orgs";

// Server layout for every authenticated page. Resolves the session and active
// org once, then hands display data to the (client) AppShell. Anyone without an
// org is routed to onboarding so the rest of the app can assume a tenant.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const orgId = await getActiveOrgId(userId);
  if (!orgId) redirect("/onboarding");

  const orgs = await listOrgsForUser(userId);
  const current = orgs.find((o) => o.id === orgId) ?? orgs[0];

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell
      userEmail={session.user?.email ?? ""}
      orgName={current?.name ?? "—"}
      role={current?.role ?? "member"}
      signOutAction={doSignOut}
    >
      {children}
    </AppShell>
  );
}
