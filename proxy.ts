// Next 16 "Proxy" (formerly Middleware). Optimistic auth gate only — a cheap
// session-cookie presence check; real authorization (membership, role, org
// scoping) happens server-side via requireTenant(). Runs on the edge where `pg`
// can't load, so it never imports auth/db.

import { NextResponse, type NextRequest } from "next/server";

// /api/cron (CRON_SECRET), /api/webhooks (per-integration signatures), and
// /api/widget (opaque per-org widget key) are authed by their own secrets/keys,
// not a session cookie, so they're allowed through. /lottery.html is a public
// static page (public/lottery.html) with no tenant data. /learning-center is a
// standalone app with its OWN cookie session (lc_session, enforced server-side
// in its layouts/actions) — the platform's Auth.js gate must not intercept it.
const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/health", "/api/cron", "/api/webhooks", "/api/widget", "/lottery.html", "/learning-center"];

function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies.has("authjs.session-token") || req.cookies.has("__Secure-authjs.session-token");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (!hasSessionCookie(req)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
