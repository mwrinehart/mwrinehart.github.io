import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireLcSession, signOutLc } from "@/lib/modules/learning-center/auth";
import { getSource } from "@/lib/modules/learning-center/source";
import { brandingForUserTeams } from "@/lib/modules/learning-center/tenant";

// Learner-facing chrome: slim top bar, content below. Admins get a link into
// the dashboard; everyone gets sign-out. The header reflects the learner's
// tenant branding (name + logo) when configured.
export default async function LearnerLayout({ children }: { children: ReactNode }) {
  const session = await requireLcSession();
  const isAdmin = session.role === "owner" || session.role === "team_admin";

  // Tenant branding for the header (best-effort; falls back to Jericho).
  let portalName = "Jericho Security Learning Center";
  let logoUrl: string | null = null;
  if (session.litmosUserId) {
    try {
      const source = await getSource();
      const [allTeams, userTeams] = await Promise.all([source.listTeams(), source.listUserTeams(session.litmosUserId)]);
      const settings = await brandingForUserTeams(allTeams, userTeams);
      if (settings?.portalName) portalName = settings.portalName;
      if (settings?.logoUrl) logoUrl = settings.logoUrl;
    } catch {
      // keep defaults
    }
  }

  async function signOut() {
    "use server";
    await signOutLc();
    redirect("/learning-center/login");
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-lc-line bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between gap-4">
          <Link href="/learning-center" className="flex items-center gap-2.5 min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-6 w-auto" />
            ) : (
              <Image src="/learning-center/logo-icon.png" alt="" width={26} height={26} unoptimized />
            )}
            <span className="font-bold text-lc-ink text-sm truncate">{portalName}</span>
          </Link>
          <nav className="flex items-center gap-4 shrink-0">
            {isAdmin && (
              <Link
                href="/learning-center/admin"
                className="rounded-lg bg-lc-purple px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
              >
                Team admin
              </Link>
            )}
            <span className="hidden sm:block text-xs text-lc-muted font-medium truncate max-w-40">{session.displayName}</span>
            <form action={signOut}>
              <button type="submit" className="text-xs font-semibold text-lc-muted hover:text-lc-ink cursor-pointer">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
