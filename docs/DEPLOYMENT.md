# Deployment (DigitalOcean Droplet)

The platform deploys as three containers on one Droplet — the Next.js app
(standalone build), PostgreSQL, and Caddy (automatic TLS + reverse proxy) — via
`docker-compose.yml`. This mirrors how Horizon Scanner already shipped to a
Droplet, consolidated into one compose file.

```
Internet ──443──▶ Caddy ──▶ app:3000 ──▶ db:5432
                  (TLS)      (Next.js)     (Postgres, private)
```

## Prerequisites

- An Ubuntu Droplet with Docker Engine + the Compose plugin installed.
- A DNS **A record** pointing your domain at the Droplet's IP (Caddy needs it to
  issue a certificate).

## First deploy

```bash
# on the Droplet
sudo git clone https://github.com/mwrinehart/mwrinehart.github.io.git /opt/jericho-platform
cd /opt/jericho-platform

# create the (gitignored) env file
cp .env.example .env
nano .env   # set the values below

docker compose up -d --build
docker compose logs -f app   # watch "[migrate] platform + module schema ready"
```

### Required `.env` values

| Var | How to set |
| --- | --- |
| `DOMAIN` | your domain, e.g. `app.jerichosecurity.com` |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PLATFORM_MASTER_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (encrypts per-org secrets — **required** unless `NODE_ENV=development`; losing/changing it makes stored org secrets unreadable, and a secret write will now refuse rather than silently wipe them) |
| `POSTGRES_PASSWORD` | a strong password |
| `AUTH_SSO_PROVIDER` + OIDC vars | for production SSO (set `AUTH_DEV_LOGIN=0`) |
| `PLATFORM_ADMIN_EMAILS` | comma-separated admin emails |
| `ANTHROPIC_API_KEY` | for Compliance/Studio AI features |

`DATABASE_URL` is injected by `docker-compose.yml` (points at the `db` service) —
don't set it in `.env` for the Docker deployment.

> **Production:** the passwordless dev login is now hard-off unless
> `NODE_ENV=development` or `AUTH_DEV_LOGIN=1`, so a deploy that left `NODE_ENV`
> unset won't expose it — but configure real SSO before exposing the app.
> Email+password login is also off by default in production; set
> `AUTH_PASSWORD_LOGIN=1` to enable it.

## Schema / migrations

Tables are created automatically on app boot by `runMigrations()`
(`instrumentation.ts`) — platform tables first, then each module's migrator. No
manual migration step. (For schema changes during development, `npm run db:push`
applies the Drizzle schema directly.)

## Updating

```bash
cd /opt/jericho-platform && ./deploy/deploy.sh   # git pull + rebuild + restart
```

### Optional: auto-deploy on push (GitHub Actions)

Add this as `.github/workflows/deploy.yml` **via the GitHub UI** (committing
workflow files over git needs a token with the `workflow` scope) and set the
`DROPLET_HOST`, `DROPLET_USER`, and `DROPLET_SSH_KEY` repo secrets:

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_HOST }}
          username: ${{ secrets.DROPLET_USER }}
          key: ${{ secrets.DROPLET_SSH_KEY }}
          script: cd /opt/jericho-platform && ./deploy/deploy.sh
```

## Scheduled jobs (cron)

The platform has no in-process worker; scheduled work runs as named jobs invoked
by an external scheduler hitting `/api/cron/<job>` with the `CRON_SECRET`. Set
`CRON_SECRET` in `.env`, then add a crontab on the Droplet:

```cron
# every 15 minutes: scan all orgs' threat-pulse feeds + auto-route critical findings
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/pulse-scan
# every 15 minutes: scan all orgs' compliance/regulatory feeds
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/compliance-scan
# every 10 minutes: AI-summarize new compliance findings (bounded per run)
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/compliance-analyze
# hourly: send any pulse digests due this hour
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/pulse-digests
# every minute: activate scheduled Litmos assignments that are now due
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/litmos-activate
# every 5 minutes: poll Litmos for assignment completions
*/5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/litmos-poll
# every 15 minutes: Learning Center assignment rules (new-member + scheduled)
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/lc-rules
# daily at 14:00 UTC: Learning Center due-date/compliance reminder emails
0 14 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://$DOMAIN/api/cron/lc-reminders
```

`GET /api/cron/all` runs every registered job; an unknown job returns the job
list. Each run is recorded in the `cron_runs` table. The endpoint returns 401
until `CRON_SECRET` is set, and the comparison is constant-time.

## Backups & ops

- **Database**: persisted in the `pgdata` Docker volume. Schedule
  `docker compose exec -T db pg_dump -U postgres jericho | gzip > backup.sql.gz`.
- **Secrets**: keep `PLATFORM_MASTER_KEY` backed up separately from the DB — it
  decrypts every org's integration credentials.
- **Health**: `GET /api/health`. **Logs**: `docker compose logs -f app`.
