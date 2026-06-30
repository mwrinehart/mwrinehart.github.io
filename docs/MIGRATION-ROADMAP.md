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

Horizon is the largest single-file app (~5.3k-line `server.js`); rebuilt as a
proper module on the shared spine.

**Delivered (this increment):**

- ✅ **Per-tenant feeds + policies** — each org configures its own feeds and
  compliance policies (empty by default; `compliance_feeds`, `compliance_policies`).
- ✅ **Scanner on the shared feed engine** — `compliance_findings` classified by a
  built-in compliance/regulatory ruleset (HIPAA/NIST/PCI/CISA/Federal Register/…),
  deduped by link. Manual "Scan now" + the `compliance-scan` cron job.
- ✅ Module wired live (registry, migrator, cron, schema re-export). The SSRF
  feed-URL guard is now shared in `lib/platform/feeds.ts` (Pulse + Compliance).

- ✅ **AI summaries + policy cross-reference** — findings are summarized and mapped
  to the tenant's policies via the **shared Anthropic client** (per-org key or
  platform key). Manual per-finding "Analyze", bulk "Analyze new", and the
  `compliance-analyze` cron job (bounded per run).

- ✅ **Alerting + auto-routes** — per-tenant rules push new findings (≥ chosen
  severity, optional category filter) to Slack/Teams/email via the **unified
  notifier**, fired in-band as the scan inserts findings.

- ✅ **Custom keywords + composite scoring + feedback learning** — per-tenant
  keyword rules augment the classifier; findings get a composite relevance score
  (severity + keyword density + recency + learned affinity) and sort by it;
  useful/not-useful votes build a preference model that re-ranks future findings.
  Keywords/tuning tab shows match counts + what the model learned.

- ✅ **External ingestion connectors** — a connector framework feeding the same
  classify/score/dedupe/alert pipeline as RSS feeds. Federal Register works via its
  public JSON API; HHS breach + OIG work plan ingest from a tenant-configured JSON
  endpoint (no stable public API — Horizon scraped them). Toggled + configured on
  the Feeds tab; scanned by the same `compliance-scan` job.

**Remaining in Phase 2:**

- **SharePoint / Power Automate** as additional alert channels (replacing
  `sharepoint-sync.js` / `powerautomate-sync.js`).
- HTML-scraping fallback for HHS breach / OIG (vs. the configured-endpoint model).

## Phase 3 — Studio (Make)

Make *is* the foundation, so this is largely **lift, not rewrite**.

**Delivered (this increment):** module is live on the shared spine —

- ✅ **eLearning authoring** — block-based courses (`studio_projects`): heading,
  text, bullets, quiz, image, divider; add/edit/reorder/remove; publish toggle.
- ✅ **AI course generation** — turn a topic into a validated course doc via the
  shared Anthropic client.
- ✅ **Standalone HTML export** — `/api/studio/courses/[id]/export` renders a
  self-contained, escaped HTML document.
- ✅ **Media library** — `studio_media_assets` with provider-gated generation
  requests (image/video/voice queued until a provider is configured).
- ✅ Shared `orgAnthropicKey` helper centralized in `lib/platform/ai.ts`
  (Compliance + Campaigns + Studio).

**Remaining:** media-provider integrations (ElevenLabs / fal / Synthesia /
HeyGen / OpenRouter), the timeline video composer, SCORM/xAPI packaging, and
graduating Make's billing/quotas/brand-kits into the platform layer.

## Phase 4 — Campaigns (Mirage)

Port Mirage's campaign builder, mission control + policy gates, expansion
approvals, personas/OSINT, audit log, and compliance dashboard. Migrate its
Prisma/SQLite models to Drizzle/Postgres. **Commercial product** — Mirage's
gov/DoD tenant class, classification banners, and DoD-specific copy are dropped.

**Delivered (this increment):** module is live on the shared spine —

- ✅ **Campaign lifecycle + mission control** — create campaigns; status state
  machine (draft/active/paused/completed) behind a **launch policy gate** (can't
  activate without an approved launch approval); autonomy modes (manual/review/
  auto).
- ✅ **AI blueprint** — expand an objective into a campaign plan via the shared
  Anthropic client.
- ✅ **Personas** — per-campaign personas with draft→warming→ready states.
- ✅ **Approval workflow** — request launch/expansion/content approvals (with risk
  score); admins decide on the Approvals queue; requests notify the org channel.
- ✅ **Immutable audit log** — every action writes an actor-aware entry; per-campaign
  and org-wide views.

- ✅ **Content jobs gated by autonomy** — a job brief is AI-drafted, then submitted
  through `evaluateGate` (campaign status + autonomy mode + risk) resolving the
  go/review/blocked decision: blocked when the campaign isn't active, auto-approved
  under `auto`, risk-thresholded under `review`, always review under `manual`;
  admins decide pending jobs. All audited.

**Remaining:** OSINT target workbench and a compliance/jurisdiction dashboard.

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

## Code-review follow-ups — resolved

The high-value batch (SSRF guard hardening, notify timeouts + cached SMTP
transport, per-scan alert cap + hoisted route query + SQL-increment counters, AI
JSON-parse guard, NaN-date guard) plus the deferred set are all applied:

- ✅ **External-sync pagination** — Litmos sync and `activateAssignment`'s user
  lookup now page through `/users` (cap 50 pages) instead of fetching only 200.
- ✅ **Litmos response envelope** — user lookup uses an envelope-aware extractor.
- ✅ **Report-credit time window** — "reported" credits now use the same 90-day
  window as behavior debits.
- ✅ **Risk-trend direction** — `getOrgRiskTrend` uses a least-squares slope over
  all points (UTC bucketing remains until orgs carry a timezone).
- ✅ **Nullable user email** — `users.email` is nullable; `upsertUser` stores null
  (not "") when a provider omits the claim.
- ✅ **Auth hot-path** — `getActiveMembership` resolves org + role in one place, so
  `requireTenant` no longer repeats the membership query.

Residual (documented, low priority): full DNS-rebind protection (pin resolved IP
at connect time); per-org timezone for trend bucketing.

### Second review pass (Campaigns + Studio + shared) — resolved

A 15-finding review after the Campaigns/Studio builds; all applied:

- ✅ **Tenant scoping** — content-job persona reads, content/persona/approval
  updates are all `and(orgId, …)`-scoped; a client-supplied id can't reach
  another tenant's row.
- ✅ **Concurrent decisions** — approval and content-job decisions use an atomic
  conditional update (`status = 'pending…'` in the `WHERE` + `.returning()`), so
  two reviewers can't double-decide or double-audit.
- ✅ **Campaign status machine** — `setStatus` validates against an explicit
  transition map (`completed` is terminal); no jumps to arbitrary states.
- ✅ **Autonomy gate is admin-only** — changing a campaign's autonomy mode now
  requires `requireTenant("admin")`; the unused "content" approval type is gone.
- ✅ **Per-org scan isolation** — `scanAllOrgs` / `scanAllComplianceOrgs` /
  `analyzeAllOrgs` wrap each org in try/catch so one bad org can't abort the run.
- ✅ **Scan-time SSRF re-check + send timeouts** — `scanFeed` re-validates the URL
  before fetch; `sendEmail` races the send against a 10s timeout.
- ✅ **Studio doc integrity** — `coerceBlock` is the single repair gate: persisted
  JSON, merged form edits, and quiz answers all pass through it (unknown types
  dropped, quiz `answer` clamped to a valid option index). HTML export allowlists
  image URL schemes (`http(s)` / `data:image`) and `renderBlock` has a safe
  default.
- ✅ **Studio optimistic concurrency** — `mutateDoc` is a compare-and-set on
  `updatedAt` with retry, so concurrent block edits can't silently clobber.

## Open decisions (need product input)

1. **Module entitlements / packaging** — are modules sold separately (plan-gated)
   or is it one suite? Drives `org_settings.enabled_modules` + billing.
2. **Data migration** — do we backfill existing CBM/Horizon SQLite data into
   Postgres, or start fresh per tenant?
