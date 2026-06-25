// Optimistic auth gate. Middleware runs on the edge where `pg` can't load, so it
// does NOT call auth() — it only checks for the presence of the Auth.js session
// cookie and redirects unauthenticated traffic to /login. Real authorization
// (membership, role, org scoping) happens in server code via requireTenant().
// This mirrors Make's proxy.ts approach.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/health"];

function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies.has("authjs.session-token") || req.cookies.has("__Secure-authjs.session-token");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (!hasSessionCookie(req)) {
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
