// Auth.js (NextAuth v5) configuration — the single session owner for the whole
// platform. Ported from Make's lib/auth.ts and trimmed to the providers the
// scaffold needs: OIDC (Jericho SSO), Google, email+password, and a dev login.
//
// SAML (used today by Horizon via Passport, and by Make via BoxyHQ/Polis) is a
// planned consolidation: it slots in here as one more provider behind the same
// AUTH_SSO_PROVIDER switch, so every module inherits SSO for free.
//
// Middleware does NOT import this module (pg can't run on the edge). It does an
// optimistic session-cookie check; real authorization happens in server code
// via requireTenant().

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { upsertUser } from "./orgs";
import { verifyPassword } from "./password";
import { bool, isProd, str } from "./env";

type SsoProvider = "none" | "oidc";

function present(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function selectedSsoProvider(): SsoProvider {
  const value = (str("AUTH_SSO_PROVIDER") || "none").toLowerCase();
  return value === "oidc" ? "oidc" : "none";
}

const ssoProvider = selectedSsoProvider();
const oidcConfigured = !!(str("OIDC_ISSUER") && str("OIDC_CLIENT_ID") && str("OIDC_CLIENT_SECRET"));
const googleConfigured = !!(str("GOOGLE_CLIENT_ID") && str("GOOGLE_CLIENT_SECRET"));

export const passwordLoginEnabled = !isProd || bool("AUTH_PASSWORD_LOGIN") || ssoProvider === "none";
export const devLoginEnabled = !isProd || bool("AUTH_DEV_LOGIN");

const providers: NextAuthConfig["providers"] = [];

if (ssoProvider === "oidc" && oidcConfigured) {
  providers.push({
    id: "jericho",
    name: "Jericho Security",
    type: "oidc",
    issuer: str("OIDC_ISSUER")!,
    clientId: str("OIDC_CLIENT_ID")!,
    clientSecret: str("OIDC_CLIENT_SECRET")!,
  });
}

if (googleConfigured) {
  providers.push(Google({ clientId: str("GOOGLE_CLIENT_ID")!, clientSecret: str("GOOGLE_CLIENT_SECRET")! }));
}

if (passwordLoginEnabled) {
  providers.push(
    Credentials({
      id: "password",
      name: "Email and password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const rows = await db.select().from(users).where(eq(users.id, `password:${email}`));
        const user = rows[0] ?? null;
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        return { id: user.id, email: user.email, name: user.name ?? email.split("@")[0] };
      },
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Developer login",
      credentials: { email: { label: "Email", type: "email" }, name: { label: "Name", type: "text" } },
      authorize: (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        if (!email || !email.includes("@")) return null;
        const name = String(creds?.name ?? "").trim() || email.split("@")[0];
        return { id: `dev:${email}`, email, name };
      },
    }),
  );
}

export const authProviderIds = {
  sso: ssoProvider === "oidc" && oidcConfigured ? { id: "jericho", label: "Sign in with Jericho Security" } : null,
  google: googleConfigured ? "google" : null,
  password: passwordLoginEnabled ? "password" : null,
  dev: devLoginEnabled ? "dev" : null,
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async jwt({ token, user, account }) {
      let email = present(user?.email) ?? present(token.email);
      let name = present(user?.name) ?? present(token.name);
      const existingUid = present(token.uid as string | undefined);
      const uid = account ? user?.id ?? existingUid ?? token.sub : existingUid ?? user?.id ?? token.sub;
      if (uid) {
        if (!email || !name) {
          const rows = await db.select().from(users).where(eq(users.id, uid));
          const row = rows[0] ?? null;
          email = email ?? present(row?.email);
          name = name ?? present(row?.name);
        }
        token.uid = uid;
        if (email) token.email = email;
        if (name) token.name = name;
        if (user) await upsertUser({ id: uid, email: email ?? null, name });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = present(token.uid as string | undefined) ?? session.user.id;
        session.user.email = present(token.email) ?? session.user.email;
        session.user.name = present(token.name) ?? session.user.name;
      }
      return session;
    },
  },
});
