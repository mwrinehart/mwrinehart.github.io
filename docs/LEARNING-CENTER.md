# Jericho Security Learning Center

A standalone app at **`/learning-center`**: a Netflix-style learner portal plus
a **Litmos LMS tenant-admin dashboard** that gives Team Admins a real
management surface over their team — everything driven by the SAP Litmos REST
API (v1). It is deliberately **not** a platform module: it has its own
email-code login, its own light Jericho-brand theme (DM Sans, Purple `#6119E5`,
Ink `#312956`, Orange accent), and its own tables — it only reuses the
platform's plumbing (Postgres, mailer, cron runner, migrations).

## Access model

Sign-in is a 6-digit one-time email code (no passwords, no self-signup).
Authorization is derived from Litmos itself at login:

| Who | How they qualify | What they see |
| --- | --- | --- |
| **Owner** | Email in `LEARNING_CENTER_OWNER_EMAILS`, or Litmos `Account_Owner`/`Administrator` access level | Everything: all teams, settings page |
| **Team admin** | Designated Team Admin on ≥1 Litmos team (`/teams/{id}/admins`) | Admin dashboard scoped to their teams **+ all sub-teams** (Litmos control inheritance) |
| **Learner** | Any active Litmos user | Learner view only |

Every admin server action re-authenticates, re-checks the target team against
the session's scope, and writes an audit row (`lc_audit_log`).

## Demo mode

With no `LITMOS_API_KEY` (or with `LEARNING_CENTER_DEMO=1`) the whole app runs
against a seeded in-memory tenant — two customer orgs (Meridian Health on a
custom brand, Northwind Logistics on the Jericho brand), sub-teams, 15
security-awareness courses with due/compliance policies in every state,
learning paths, gamification. Sign in as `matt@jerichosecurity.com` (owner),
`admin@meridianhealth.com` (team admin), or `leo.fontaine@meridianhealth.com`
(learner); the login code is shown on screen when SMTP isn't configured.

## Team-admin capabilities → Litmos API mapping

| Capability | How it works |
| --- | --- |
| **Manage users** | Create (`POST /users`, optional welcome email), edit/deactivate (`PUT /users/{id}` full-record), add/remove team members, create sub-teams, promote/demote Team Admins & Team Leaders (`PUT/DELETE /teams/{id}/admins|leaders/{uid}`) |
| **Manage assignments** | Team courses & learning paths (`POST/DELETE /teams/{id}/courses|learningpaths`, incl. sub-team cascade), individual assignment (`POST /users/{id}/courses|learningpaths`), honest LP-sourced unassign errors |
| **Manage due dates** | Course-level policy (fixed `DueDate` or `DueDateSpan`) via `POST /bulkimports/courses`; per-learner due status read from `GET /courses/{id}/users`; manual reminder sends |
| **Manage compliance dates** | `ComplianceDateSpan`/`ComplianceRetake` via bulk import; per-learner `CompliantTill` standing; **reset for recertification** (`PUT /users/{uid}/courses/{cid}/reset`); manual reminder sends |
| **Duplicate library courses** | Content Library (Active) → team library: bulk-import shell with inherited settings → resolve by code → `POST /courses/{new}/modules/copy|link|mirror` → team-library placement; per-copy progress tracking + a settings page for the duplicate |
| **Assignment rules** | Dashboard-owned engine (Litmos Assign is owner-only + premium): `member_joined` (diff vs seen members, per-user assignment) and `schedule` (team-level re-assignment every N days); cron `lc-rules` + "Run now" |
| **Notifications per brand** | Team's brand = dominant member `Brand`; custom-brand teams manage their own templates (welcome/assignment/due/compliance/custom, `{{placeholders}}`); Jericho-default-brand teams are read-only. No Litmos template API exists — sends go through the platform mailer and are logged |
| **Trigger / resend** | Resend sign-in link (fresh `LoginKey` from `GET /users/{id}` — Litmos has no resend endpoint), manual due/compliance reminder blasts, custom messages to team or member; plus Litmos-native `sendmessage` flags on create/assign |
| **Leaderboards & gamification** | `GET /teams/{id}/gamificationdetails` → computed rankings (points-first, 1224 ties), podium, **sub-team standings by average points**, per-user summary/badges; owner-gated `PUT /users/{id}/gamificationreset`. 403 → "gamification disabled" state |
| **Everything else** | Overview health metrics, member drill-down, CSV exports (member progress, assignment detail), results feed (`/results/details`), achievements + certificates, full audit log |

## Tenant self-service configuration (phase 2)

A "tenant" is a top-level Litmos team; its configuration applies to the whole
subtree and is owned by the dashboard (none of it exists in the Litmos API).
Settings attach to the tenant root and are gated on the acting admin's scope
including that root.

| Capability | How it works |
| --- | --- |
| **Assign to individuals / group / everyone** | The assignments page audience selector: one member, everyone in the team, or everyone in the team + all sub-teams (fans out `POST /users/{id}/courses` per member) |
| **Per-course notifications + editable defaults** | Notification templates can be team defaults or per-course overrides; a send for a course uses the course override → team default → built-in default |
| **Rules for courses & notifications** | Rules gained a notification action (`sendTemplateType` + `notifyAudience`: affected / all / overdue / compliance-risk); a rule can assign, notify, or both, on member-join or a schedule |
| **Custom SMTP per tenant** | `lc_tenant_settings.smtp_encrypted` (AES-256-GCM via the platform master key); `notify()` gained an optional per-call `smtp` override, auto-resolved from the recipient team's tenant root, so a tenant's mail sends from its own address. Write-only URL, test-send button |
| **Brand the portal** | Tenant portal name, https logo, hex accent color, welcome message — applied to the learner header/hero and certificates. Logo/color validated (https-only, `#rrggbb`) |
| **Gamification config** | Enable/disable, leaderboard visibility, per-completion bonus points, custom badges (manual / complete-a-course / complete-N-courses) with bonus points; manual awards; auto-award evaluation on the `lc-rules` cron and on demand. Leaderboards merge Litmos points with dashboard awards + completion bonus |
| **Certificates** | Per-tenant config (title, body line, signer, scope=all/selected). Learners get a print-ready certificate page for eligible completed courses/paths (browser Print → PDF) |
| **Generate an API key** | Per-tenant keys (`lck_…`, sha256-stored, shown once) scoped to the tenant subtree, authenticating the Learning Center REST API |

### Tenant REST API (`/learning-center/api/v1/*`)

`Authorization: Bearer lck_…`. Every response is scoped to the key's tenant
subtree. `GET /users`, `GET /courses`, `GET /teams` (read scope); `POST
/assignments` `{ email, courseId }` (assign scope — the target must belong to
the key's tenant, else 403). Unknown/revoked key → 401; missing scope → 403.

## Honest API limitations (surfaced in the UI)

- **No whole-course copy API** — duplication is orchestrated from documented
  primitives (bulk-import shell + module copy/link/mirror). Non-eLearning
  module types can't be created via API; module *content* is edited in Litmos.
- **Per-user due dates are read-only** via the API; due-date policy is
  course-level (the UI says so). Bulk-import spans cap at 100 days.
- **No notification-template API and no resend API** — the dashboard owns
  templates and sends via SMTP; login links are rebuilt from `LoginKey`.
- **No leaderboard endpoint; points can't be granted via API** — rankings are
  computed; reset is the only write.
- Rate limit ≈100 req/min, returned as HTTP **503** — the client retries with
  backoff, reports fan out with bounded concurrency and a 200-user cap.

## Configuration

```
LITMOS_API_KEY=                  # account-level key; absent → demo mode
LITMOS_BASE_URL=                 # default https://api.litmos.com/v1.svc (regional hosts allowlisted)
LITMOS_SOURCE=jericho-learning-center
LITMOS_LEARNER_URL=https://jerichosecurity.litmos.com
LEARNING_CENTER_DEMO=            # 1 forces demo
LEARNING_CENTER_OWNER_EMAILS=matt@jerichosecurity.com
LEARNING_CENTER_DEFAULT_BRANDS=  # default "jericho security,default"
SMTP_URL= / SMTP_FROM=           # required for real email sends
```

Cron (see `docs/DEPLOYMENT.md`): `lc-rules` every 15 min, `lc-reminders` daily.

## Data & code layout

Tables (all `lc_*`, migrated at boot): sessions, login codes, assignment rules
(+ runs + seen members), notification templates (+ sends), course copies,
audit log. Litmos stays the system of record for users/teams/courses/results.

`lib/modules/learning-center/` — `types` (PascalCase Litmos records), `client`
(live REST: apikey header, `source` + `format=json`, paging, 503 backoff,
ordered full-record user writes), `demo` (seeded tenant), `source` (the
interface both implement), `auth`, `scope` (team-tree math), `context`
(per-request admin scope), `rules`, `notifications`, `duplicate`,
`leaderboard`, `reports`, `audit`, `jobs`.

`app/learning-center/` — login, learner home + course pages, `admin/*`
(overview, users [+detail], assignments, due-dates, compliance, library
[+course settings], rules, notifications, leaderboards, reports, audit,
settings), `api/export` (CSV).
