import { redirect } from "next/navigation";
import { auth } from "@/lib/platform/auth";
import { createOrg } from "@/lib/platform/orgs";

// Shown to a signed-in user who isn't in any org yet. Creates their first org and
// makes them owner, then drops them at the dashboard.
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  async function create(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login");
    const name = String(formData.get("name") || "").trim() || "My Organization";
    await createOrg(name, s.user.id);
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
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
