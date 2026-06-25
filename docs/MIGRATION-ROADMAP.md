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

Port CBM-Next's domain onto the spine.

**Delivered (this increment):**

1. ✅ **Data-source sync** — `data_source_configs` / `data_sync_runs` + the Jericho
   app and Litmos connectors (origin-allowlisted, deduped import ledgers). Ingests
   people, groups, campaign/triage events; recomputes risk after each sync.
   Sources page configures credentials + triggers sync.
2. ✅ **Risk scoring** — derived from ingested signals (CBM had no formula; scores
   came from an external service). Behaviors synthesized idempotently from campaign
   "click" events; `risk_score_history` change-points + org trend. Manual recompute.
3. ✅ **Threat Pulse** — feed + keyword-rule management, scan-now on the shared feed
   engine (built-in CATEGORY/SEVERITY classifier), dedupe by link, and auto-route
   of critical/high findings to Slack/Teams via the unified notifier.
4. ✅ **Nudges** — `nudge_configs` CRUD + send across device/Slack/Teams with a
   `nudge_events` delivery log.

5. ✅ **Background scheduling** — platform cron layer (`lib/platform/cron.ts` + job
   registry + `cron_runs` log + secured `/api/cron/<job>` endpoint). Behavior
   registers `pulse-scan` (all orgs) and `pulse-digests` (hourly tick). An external
   scheduler (Droplet crontab) drives cadence. The device-nudge widget remains a
   follow-up.
6. ✅ **Email transport** — nodemailer wired into the unified notifier; Pulse
   digests (`pulse_digests`) and email nudges now send.

7. ✅ **Remaining CBM pages** — Policy Center (policies + acknowledgments),
   Compliance Frameworks (control evidence), Maturity (0–5 scoring + snapshots),
   Brand Protection (domains + impersonations), Reports (cross-domain snapshot +
   saved reports), and Litmos training (assign + scheduled activation + completion
   polling + HMAC-verified completion webhook). Litmos activate/poll run as cron
   jobs.

8. ✅ **Device-nudge widget** — a public, CORS-open embeddable JS snippet
   (`/api/widget/<key>/script`) scoped by a rotatable per-org widget key. It
   renders the org's active device nudges as toast reminders, deduped per browser
   via localStorage. Embed snippet + key rotation live on the Nudges page.

**Phase 1 is complete** — the Behavior module fully covers CBM-Next's surface.

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
Prisma/SQLite models to Drizzle/Postgres. **Commercial product** — Mirage's
gov/DoD tenant class, classification banners, and DoD-specific copy are dropped.

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

## Resolved decisions

- **Hosting → DigitalOcean Droplet.** Docker Compose (app + Postgres + Caddy) on
  one Droplet. See [`DEPLOYMENT.md`](DEPLOYMENT.md).
- **Commercial product, no gov/DoD.** Mirage's DoD tenant class and
  classification features are dropped from the Campaigns module.

## Open decisions (need product input)

1. **Module entitlements / packaging** — are modules sold separately (plan-gated)
   or is it one suite? Drives `org_settings.enabled_modules` + billing.
2. **Data migration** — do we backfill existing CBM/Horizon SQLite data into
   Postgres, or start fresh per tenant?
