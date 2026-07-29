// Learning Center sign-in: email → 6-digit one-time code → session. No
// passwords and no self-signup — access mirrors the Litmos tenant (owners via
// env allowlist). In demo/dev without SMTP the code is shown inline so the
// product is fully usable out of the box.

import Image from "next/image";
import { redirect } from "next/navigation";
import { getLcSession, requestLoginCode, verifyLoginCode } from "@/lib/modules/learning-center/auth";
import { isDemoMode } from "@/lib/modules/learning-center/config";
import { lcBtnPrimary, lcInputCls } from "@/components/learning-center/ui";

export default async function LearningCenterLogin({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string; code?: string; error?: string }>;
}) {
  const params = await searchParams;
  if (await getLcSession()) redirect("/learning-center");
  const demo = isDemoMode();

  async function sendCode(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const result = await requestLoginCode(email);
    const q = new URLSearchParams({ email });
    if (!result.ok) q.set("error", result.error ?? "Could not send a code.");
    else {
      q.set("sent", "1");
      if (result.inlineCode) q.set("code", result.inlineCode);
    }
    redirect(`/learning-center/login?${q.toString()}`);
  }

  async function verify(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const code = String(formData.get("code") ?? "").trim();
    const result = await verifyLoginCode(email, code);
    if (!result.ok) {
      const q = new URLSearchParams({ email, sent: "1", error: result.error ?? "Sign-in failed." });
      redirect(`/learning-center/login?${q.toString()}`);
    }
    redirect("/learning-center");
  }

  return (
    <div className="min-h-screen flex">
      {/* Brand panel — the one bold flat-purple moment (sandwich structure). */}
      <div className="hidden lg:flex w-[44%] bg-lc-purple text-white flex-col justify-between p-12">
        <div className="inline-flex items-center gap-3">
          <span className="inline-flex items-center justify-center rounded-xl bg-white p-1.5">
            <Image src="/learning-center/logo-icon.png" alt="" width={30} height={30} />
          </span>
          <span className="text-lg font-bold">Jericho Security</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight max-w-md">Learning Center</h1>
          <p className="mt-4 text-white/85 max-w-md text-sm leading-relaxed">
            Security awareness training for your whole team — assignments, compliance, and progress in one place.
          </p>
        </div>
        <p className="text-xs text-white/70">Team admins: sign in with your work email to manage your team.</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <Image src="/learning-center/logo-icon.png" alt="Jericho Security" width={28} height={28} />
            <span className="font-bold">Jericho Security Learning Center</span>
          </div>

          <h2 className="text-2xl font-bold text-lc-ink">Sign in</h2>
          <p className="text-sm text-lc-muted mt-1 mb-6">We&apos;ll email you a one-time code — no password needed.</p>

          {params.error && <div className="mb-4 rounded-xl bg-lc-amber/15 px-4 py-3 text-sm font-medium text-lc-ink">{params.error}</div>}

          {!params.sent ? (
            <form action={sendCode} className="space-y-3">
              <input
                type="email"
                name="email"
                required
                defaultValue={params.email ?? ""}
                placeholder="you@company.com"
                className={lcInputCls}
                autoComplete="email"
              />
              <button type="submit" className={`${lcBtnPrimary} w-full`}>
                Email me a code
              </button>
            </form>
          ) : (
            <form action={verify} className="space-y-3">
              <input type="hidden" name="email" value={params.email ?? ""} />
              <div className="text-sm text-lc-muted">
                Code sent to <span className="font-semibold text-lc-ink">{params.email}</span>
              </div>
              {params.code && (
                <div className="rounded-xl bg-lc-tint px-4 py-3 text-sm">
                  Demo mode — your code is <span className="font-bold tracking-widest text-lc-purple">{params.code}</span>
                </div>
              )}
              <input
                type="text"
                name="code"
                required
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="6-digit code"
                className={`${lcInputCls} tracking-[0.4em] text-center text-lg font-bold`}
                autoComplete="one-time-code"
              />
              <button type="submit" className={`${lcBtnPrimary} w-full`}>
                Sign in
              </button>
              <a href={`/learning-center/login?email=${encodeURIComponent(params.email ?? "")}`} className="block text-center text-xs font-semibold text-lc-purple hover:underline">
                Use a different email
              </a>
            </form>
          )}

          {demo && !params.sent && (
            <div className="mt-8 rounded-xl border border-lc-line p-4 text-xs text-lc-muted leading-relaxed">
              <div className="font-semibold text-lc-ink mb-1">Demo tenant accounts</div>
              <div>
                <span className="font-semibold">matt@jerichosecurity.com</span> — account owner
              </div>
              <div>
                <span className="font-semibold">admin@meridianhealth.com</span> — team admin (Meridian Health)
              </div>
              <div>
                <span className="font-semibold">hank.bauer@northwindlogistics.com</span> — team admin (Northwind)
              </div>
              <div>
                <span className="font-semibold">leo.fontaine@meridianhealth.com</span> — learner
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
