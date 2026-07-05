# Architecture

## Goal

Four Jericho products — **Make** (Content Studio), **Mirage** (campaign
simulation), **Horizon Scanner** (compliance radar), and **CBM-Next** (behavior
management) — rebuilt as **one** multi-tenant application: a shared platform spine
plus pluggable product modules. The user-selected approach is a *unified rebuild*
(one codebase) rather than a monorepo of separate apps.

The spine has since carried its first **net-new** module, **Narrative**
(disinformation monitoring and human-approved counter-messaging), built directly
on the module contract rather than ported from a source app — see
`MIGRATION-ROADMAP.md` Phase 5.

## Why this shape

The four apps overlapped heavily and re-implemented the same primitives
differently:

- **Tenancy & identity** — all four had orgs/users, with three different auth
  schemes (Auth.js v5 in Make, custom JWT in Mirage/CBM, Passport SAML in
  Horizon) and three different secret stores.
- **Notifications** — Slack/Teams/email send logic was reimplemented in CBM,
  Horizon, and Make.
- **Feed scanning** — Horizon's "Compliance Radar" and CBM's "Threat Pulse" are
  the same RSS → keyword → severity → finding pipeline.
- **AI** — Make and Horizon both call Anthropic Claude.

Consolidating these into one platform layer removes the duplication and lets each
module focus on its domain.

### Why Make's stack is the foundation

Make is the only source app with strict TypeScript, real SSO (OIDC/SAML via
Auth.js), Stripe billing, plan-based quotas, and a deliberately single-seam
tenancy model (`getOrgId()`). The other three are plain JS (CBM, Horizon) or use
SQLite/Prisma (Mirage). Adopting Make's stack — Next.js 16 + TS + Postgres/Drizzle
+ Auth.js v5 — means the hardest platform problems are already solved; porting is
mostly translating domain logic, not rebuilding infrastructure.

## The platform spine (`lib/platform/`)

| Concern | File | Notes |
| --- | --- | --- |
| Database | `db/index.ts`, `db/schema.ts` | One Postgres database, pooled pg + Drizzle. `runMigrations()` creates platform tables, then calls each module's migrator. |
| Identity / sessions | `auth.ts` | Auth.js v5 (JWT sessions). Providers: OIDC (Jericho SSO), Google, email+password, dev login — all behind env switches. |
| Tenancy & RBAC | `org.ts`, `orgs.ts` | `requireTenant(minRole?)` is the single authorization seam. Roles: owner > admin > member > viewer. |
| Encrypted secrets | `secrets.ts` | Per-org AES-256-GCM blob in `orgs.encrypted_secrets` (ported from CBM's `orgSecrets.js`). |
| Notifications | `notify.ts` | Unified Slack/Teams/email sender; every send logged to `notification_log`. |
| Feed engine | `feeds.ts` | Shared RSS scan + keyword classifier (Horizon + CBM Pulse). |
| AI | `ai.ts` | Dependency-free Anthropic Messages client; per-org key override. |
| Module registry | `modules.ts` | Client-safe source of truth for nav, status, and source-app provenance. |

## Tenancy model

- Every request resolves an **active org** from the signed-in user
  (`getOrgId()` → `requireOrgId()` → `requireTenant()`). Isolation is enforced in
  this one place; data functions take an explicit `orgId`.
- Isolation is by `org_id` column, **not** separate databases. Modules add
  `org_id` to all their tables.
- Platform-admin status is env-driven (`PLATFORM_ADMIN_EMAILS`), re-checked per
  call. The `impersonation_log` table exists now; the full impersonation cookie
  machinery (from Make) is a later phase, and `getUserId()` is the seam where the
  impersonated id will be substituted.

## Key reconciliation: accounts vs. people

CBM's `users` table conflated **login accounts** with **monitored employees**. In
the platform these are split:

- **`users`** (platform) — Auth.js login identities.
- **`behavior_people`** (Behavior module) — the humans whose security risk is
  tracked; they may have no login at all.

This separation is the template for resolving similar overloads as Mirage
(personas vs. operators) and Horizon (analysts vs. policies) are ported.

## Conventions

- **Timestamps**: epoch-milliseconds, stored as `bigint` (`{ mode: "number" }`) —
  Make's convention, applied platform-wide.
- **Module isolation**: a module owns `lib/modules/<id>/` (schema, migrate, logic)
  and `app/(app)/<id>/` (routes). It depends on the platform; the platform never
  imports a module except (a) the schema re-export and (b) the migrator list in
  `db/index.ts`.
- **Edge safety**: `middleware.ts` does an optimistic session-cookie check only
  (no `pg` on the edge). Real authorization is in server code.

## Request lifecycle

```
Browser
  → middleware.ts            (optimistic: has session cookie? else → /login)
  → app/(app)/layout.tsx     (auth() → active org → AppShell, else → /onboarding)
  → page (server component)  (requireTenant(minRole) → { userId, orgId, role })
  → lib/modules/<id>/*       (domain logic, scoped by orgId)
  → Drizzle → Postgres
```
