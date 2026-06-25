import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { authProviderIds, signIn } from "@/lib/platform/auth";

// Sign-in page. Renders only the providers that are actually enabled (dev login +
// email/password by default; SSO/Google when configured). Server actions call
// Auth.js signIn directly.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string; error?: string }> }) {
  const { from, error } = await searchParams;
  const redirectTo = typeof from === "string" && from.startsWith("/") ? from : "/dashboard";

  async function devLogin(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "");
    const name = String(formData.get("name") || "");
    await signIn("dev", { email, name, redirectTo });
  }

  async function passwordLogin(formData: FormData) {
    "use server";
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    try {
      await signIn("password", { email, password, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) redirect("/login?error=invalid");
      throw err;
    }
  }

  async function oauthLogin(formData: FormData) {
    "use server";
    const provider = String(formData.get("provider") || "");
    await signIn(provider, { redirectTo });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Jericho Security</h1>
          <p className="text-sm text-jericho-muted mt-1">Unified Platform</p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-jericho-bad/15 px-3 py-2 text-sm text-jericho-bad">
            Invalid email or password.
          </p>
        )}

        {authProviderIds.sso && (
          <form action={oauthLogin} className="mb-3">
            <input type="hidden" name="provider" value={authProviderIds.sso.id} />
            <Button>{authProviderIds.sso.label}</Button>
          </form>
        )}
        {authProviderIds.google && (
          <form action={oauthLogin} className="mb-3">
            <input type="hidden" name="provider" value="google" />
            <Button>Continue with Google</Button>
          </form>
        )}

        {authProviderIds.password && (
          <form action={passwordLogin} className="space-y-3 mb-3">
            <Field name="email" type="email" placeholder="you@company.com" label="Email" />
            <Field name="password" type="password" placeholder="••••••••" label="Password" />
            <Button>Sign in</Button>
          </form>
        )}

        {authProviderIds.dev && (
          <details className="mt-4 rounded-lg border border-jericho-border p-3">
            <summary className="text-sm text-jericho-muted cursor-pointer">Developer login</summary>
            <form action={devLogin} className="space-y-3 mt-3">
              <Field name="email" type="email" placeholder="dev@jerichosecurity.com" label="Email" />
              <Field name="name" type="text" placeholder="Name (optional)" label="Name" />
              <Button>Enter as developer</Button>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}

function Field({ name, type, placeholder, label }: { name: string; type: string; placeholder: string; label: string }) {
  return (
    <label className="block">
      <span className="text-xs text-jericho-muted">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={name !== "name"}
        className="mt-1 w-full rounded-lg border border-jericho-border bg-jericho-bg px-3 py-2 text-sm outline-none focus:border-jericho-accent"
      />
    </label>
  );
}

function Button({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-lg bg-jericho-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
    >
      {children}
    </button>
  );
}
