import { redirect } from "next/navigation";
import { auth } from "@/lib/platform/auth";
import { acceptInvite, createOrg, listPendingInvitesForEmail } from "@/lib/platform/orgs";

// Shown to a signed-in user who isn't in any org yet. They can accept a pending
// invite (if one was sent to their email) or create their own org and become its
// owner, then land on the dashboard.
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const pending = await listPendingInvitesForEmail(session.user.email);

  async function create(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login");
    const name = String(formData.get("name") || "").trim() || "My Organization";
    await createOrg(name, s.user.id);
    redirect("/dashboard");
  }

  async function accept(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login");
    await acceptInvite(String(formData.get("token") || ""), s.user.id, s.user.email);
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {pending.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-center">You&apos;ve been invited</h2>
            <p className="text-sm text-jericho-muted text-center mt-1 mb-4">Accept an invite to join an existing organization.</p>
            <div className="space-y-2">
              {pending.map((inv) => (
                <form key={inv.id} action={accept} className="flex items-center justify-between gap-3 rounded-lg border border-jericho-border px-3 py-2">
                  <input type="hidden" name="token" value={inv.token} />
                  <span className="text-sm">
                    <span className="text-jericho-text">{inv.orgName}</span>
                    <span className="text-jericho-muted"> · {inv.role}</span>
                  </span>
                  <button type="submit" className="rounded-lg bg-jericho-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
                    Accept
                  </button>
                </form>
              ))}
            </div>
            <div className="text-center text-xs text-jericho-muted mt-6">or create your own organization</div>
          </div>
        )}

        <h1 className="text-2xl font-semibold text-center">Create your organization</h1>
        <p className="text-sm text-jericho-muted text-center mt-1 mb-6">
          Everything in the platform is scoped to an organization. You can invite teammates later.
        </p>
        <form action={create} className="space-y-3">
          <input
            name="name"
            placeholder="Acme Corp"
            required
            className="w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Create organization
          </button>
        </form>
      </div>
    </div>
  );
}
