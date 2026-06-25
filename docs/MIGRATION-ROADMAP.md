# Migration roadmap

A unified rebuild, phased so the platform is always runnable and each module
lands behind the shared spine. **Anchor module: Behavior (CBM).**

## Phase 0 — Foundation scaffold ✅ (this commit)

The runnable skeleton:

- Next.js 16 + TS + Tailwind v4 + Drizzle/pg toolchain.
- Platform spine: db client + platform schema, Auth.js v5 (OIDC/Google/password/
  dev), `requireTenant` tenancy + RBAC, per-org AES-256-GCM secret store, unified
  notifier, shared feed engine, Anthropic client, module registry.
- App shell: middleware gate, login, onboarding, cross-module sidebar, unified
  dashboard, settings.
- **Behavior module** wired end-to-end: schema + migrator, risk logic, four pages
  (overview, risk scores, behaviors, threat pulse), and a demo seed so it works
  without a live data source.
- Compliance / Studio / Campaigns mounted as documented placeholders.

## Phase 1 — Behavior (CBM) to feature parity

Port CBM-Next's domain onto the spine. Order:

1. **Data-source sync** — `data_source_configs` / `data_sync_runs` and the Jericho
   app + Litmos connectors (CBM `routes/dataSources.js`). Ingest people, groups,
   campaign/triage events → `behavior_people` + `behaviors`.
2. **Risk scoring** — replace placeholder scores with CBM's scoring + the
   `risk_score_history` trend, recomputed on sync.
3. **Nudges** — `nudge_configs`/`nudge_events` delivery via the unified notifier
   (device/Slack/Teams/email), schema already present.
4. **Threat Pulse** — feeds, keyword rules, digests, auto-routes — running on the
   shared feed engine; the scheduled scanner becomes a platform job.
5. **Policy Center, Compliance frameworks, Maturity, Brand Protection, Reports** —
   the remaining CBM pages.
6. **Litmos training assignments** — assignment automation + completion webhook.

Drop on the way in: CBM's retired tables (campaigns, SIEM, email-security) unless
a connector still needs them.

## Phase 2 — Compliance (Horizon Scanner)

Horizon is the largest single-file app (~5.3k-line `server.js`); rebuild it as a
proper module:

- Feed config + 24 keyword rules on the **shared feed engine** (the engine
  Behavior's Pulse already uses — dedupe the two).
- AI summaries + policy-mapped action items via the **shared Anthropic client**.
- Policy upload + cross-reference, composite scoring, feedback learning.
- Federal Register / breach-portal / OIG integrations.
- Alerting (Teams/Slack/email/SharePoint/Power Automate) via the **unified
  notifier** — replaces `email-notifications.js`, `sharepoint-sync.js`,
  `powerautomate-sync.js`.

## Phase 3 — Studio (Make)

Make *is* the foundation, so this is largely **lift, not rewrite**: move its
course engine, media generation, and composer into `lib/modules/studio/` +
`app/(app)/studio/`. Its billing/quotas/brand-kits/templates graduate into the
platform layer (shared by all modules), not the module.

## Phase 4 — Campaigns (Mirage)

Port Mirage's campaign builder, mission control + policy gates, expansion
approvals, personas/OSINT, audit log, and compliance dashboard. Migrate its
Prisma/SQLite models to Drizzle/Postgres. Commercial-vs-DoD tenant copy folds into
platform tenancy + per-org settings.

## Cross-cutting platform follow-ups

These benefit every module and aren't owned by one:

- **Impersonation** — port Make's HMAC-cookie admin impersonation (table exists).
- **Billing** — graduate Make's Stripe + usage ledger + plan quotas to the platform.
- **SSO/SAML** — add SAML as an Auth.js provider behind `AUTH_SSO_PROVIDER` so
  Horizon's Passport-SAML users migrate cleanly; consolidate on one IdP path.
- **Object storage** — Make notes media-as-data-URL tech debt; add S3/R2.
- **Email transport** — wire nodemailer into the unified notifier (currently
  Slack/Teams send; email is logged + skipped).
- **Tests + CI** — none of the four source apps had tests. Add Vitest + a CI
  pipeline as parity work; it's the top handoff recommendation across all four.
- **Invites + member management UI** — schema exists; build the admin console.

## Open decisions (need product input)

1. **Hosting** — this repo is `mwrinehart.github.io` (GitHub Pages = static only).
   A Postgres server app needs Node hosting. Target: managed Node + Postgres
   (Vercel + Neon/Supabase, or the existing Droplet/Docker setup)?
2. **Module entitlements / packaging** — are modules sold separately (plan-gated)
   or is it one suite? Drives `org_settings.enabled_modules` + billing.
3. **Mirage isolation** — its gov/DoD posture may need stricter tenant isolation
   (separate deployment/classification) than commercial modules. Confirm before
   Phase 4.
4. **Data migration** — do we backfill existing CBM/Horizon SQLite data into
   Postgres, or start fresh per tenant?
