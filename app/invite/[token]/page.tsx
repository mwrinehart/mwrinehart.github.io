import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/platform/auth";
import { acceptInvite, getInviteByToken } from "@/lib/platform/orgs";

// Invite acceptance. Lives outside the (app) route group so a brand-new user
// without an org isn't bounced to onboarding before they can accept. Email-bound:
// the signed-in identity must match the invited address.
export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?from=/invite/${encodeURIComponent(token)}`);

  const invite = await getInviteByToken(token);
  const sessionEmail = session.user.email ?? null;
  const emailMatches = !!sessionEmail && !!invite && sessionEmail.trim().toLowerCase() === invite.email;

  async function accept() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect(`/login?from=/invite/${encodeURIComponent(token)}`);
    await acceptInvite(token, s.user.id, s.user.email);
    redirect("/dashboard");
  }
  async function switchAccount() {
    "use server";
    await signOut({ redirectTo: `/login?from=/invite/${encodeURIComponent(token)}` });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Organization invite</h1>

        {!invite ? (
          <>
            <p className="text-sm text-jericho-muted mt-2 mb-6">
              This invite is invalid or has already been used. Ask an admin to send a new one.
            </p>
            <a href="/dashboard" className="text-sm text-jericho-accent hover:underline">
              Go to dashboard
            </a>
          </>
        ) : emailMatches ? (
          <>
            <p className="text-sm text-jericho-muted mt-2 mb-6">
              You&apos;ve been invited to join <strong className="text-jericho-text">{invite.orgName}</strong> as{" "}
              <strong className="text-jericho-text">{invite.role}</strong>.
            </p>
            <form action={accept}>
              <button type="submit" className="w-full rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                Accept invite
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-jericho-muted mt-2 mb-2">
              This invite was sent to <strong className="text-jericho-text">{invite.email}</strong>, but you&apos;re
              signed in as <strong className="text-jericho-text">{sessionEmail ?? "an account with no email"}</strong>.
            </p>
            <p className="text-xs text-jericho-muted mb-6">Sign in with the invited address to accept it.</p>
            <form action={switchAccount}>
              <button type="submit" className="w-full rounded-lg border border-jericho-border px-3 py-2 text-sm text-jericho-accent hover:bg-jericho-border/40">
                Sign in with a different account
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
