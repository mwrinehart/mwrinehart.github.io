# Jericho Security Platform

One cohesive application that consolidates four separate Jericho products into a
single, multi-tenant platform with a shared spine and pluggable modules.

| Module | Rebuilt from | What it does | Status |
| --- | --- | --- | --- |
| **Behavior** | CBM-Next | Human-risk management: risk scoring, behaviors, training nudges, threat pulse | Live |
| **Compliance** | Horizon Scanner | Regulatory & threat-feed scanning, AI summaries, policy mapping, alerting | Live |
| **Studio** | Make (Content Studio) | eLearning authoring + AI course generation + HTML export (media gen provider-gated) | Live |
| **Campaigns** | Mirage | Narrative campaign simulation: mission control, autonomy-gated content, approvals, audit | Live |
| **Agents** | New | Unified OpenClaw fleet: pair the agents running on your devices, chat with any of them, broadcast work to all | Live |

Instead of four apps each re-implementing auth, organizations, RBAC, secret
storage, notifications, RSS scanning, and an AI client, the platform provides all
of that **once** (`lib/platform/`) and each product becomes a module
(`lib/modules/`, `app/(app)/<module>/`).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · PostgreSQL + Drizzle
ORM · Auth.js v5 · Tailwind CSS v4. This is Make's stack — the most mature of the
four source apps and the only one with real SSO, billing, and a strict-typed
multi-tenant core — adopted as the foundation for the rebuild.

## Quickstart

```bash
cp .env.example .env.local      # set AUTH_SECRET, DATABASE_URL, PLATFORM_MASTER_KEY
npm install
npm run dev                     # http://localhost:3000
```

You need a PostgreSQL database (`DATABASE_URL`). Tables are created automatically
on first boot by `runMigrations()` (see `instrumentation.ts`). With
`AUTH_DEV_LOGIN=1` (the default in `.env.example`) you can sign in with any email,
create an org, then open **Behavior → Load sample data** to see the anchor module
working end to end.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run db:push     # push the Drizzle schema instead of relying on runMigrations
```

## Repository layout

```
app/
  (app)/            authenticated routes (AppShell): dashboard, settings, and one route group per module
  login/            sign-in (dev / password / SSO / Google)
  onboarding/       first-org creation
  api/              auth handlers, health
lib/
  platform/         the shared spine — db, auth, org/RBAC, secrets, notify, feeds, ai, module registry
  modules/
    behavior/       the CBM rebuild: schema, migrate, risk logic, demo seed
components/         AppShell + shared UI primitives
docs/               ARCHITECTURE, MIGRATION-ROADMAP, MODULE-CONVENTIONS
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design,
[`docs/MIGRATION-ROADMAP.md`](docs/MIGRATION-ROADMAP.md) for the phased plan, and
[`docs/MODULE-CONVENTIONS.md`](docs/MODULE-CONVENTIONS.md) for how to add the next
module.

## Deployment

Ships to a **DigitalOcean Droplet** as three containers (app + Postgres + Caddy)
via `docker-compose.yml`. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
cp .env.example .env   # set DOMAIN, AUTH_SECRET, PLATFORM_MASTER_KEY, POSTGRES_PASSWORD
docker compose up -d --build
```

> The repo name (`mwrinehart.github.io`) implies GitHub Pages, which serves
> static sites only — this Postgres-backed server app runs on the Droplet
> instead, not Pages.
