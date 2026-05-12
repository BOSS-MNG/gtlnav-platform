# GTLNAV — Cloud Infrastructure Platform

GTLNAV is the cloud-infrastructure surface inside the GODTECHLABS ecosystem.
This repository contains:

- **Control plane** — a Next.js (App Router) dashboard + API at the repo root.
- **Deployment worker** — a small Node.js service at
  [`workers/deployment-worker/`](workers/deployment-worker/) that turns
  queued `deployment_jobs` rows into real static deployments.
- **Reverse proxy config** — a sample Caddy configuration at
  [`infra/caddy/`](infra/caddy/) that serves the worker's output and
  obtains TLS certs via ACME.
- **Migrations** — versioned SQL files at
  [`supabase/migrations/`](supabase/migrations/) that provision the tables
  required for the Phase 6A deploy pipeline.

## Architecture in one breath

```
Browser ─▶ /api/deployments/start  ─▶  deployment_jobs (pending)
                                              │
                                              ▼
                            workers/deployment-worker
                            ├─ POST /api/worker/claim-job
                            ├─ git clone + install + build
                            ├─ POST /api/worker/logs   (streaming)
                            ├─ POST /api/worker/status (cloning → ... → running)
                            └─ POST /api/worker/complete (or /fail)
                                              │
                                              ▼
                      DEPLOYMENTS_ROOT/<slug>/<deployment_id>/
                                              │
                                              ▼
                              Caddy file_server + on-demand TLS
                                              │
                                              ▼
                          https://<slug>.gtlnav.app
```

## Run locally

```bash
# 1. install dependencies
npm install

# 2. set env vars
cp .env.example .env.local
#  - fill in NEXT_PUBLIC_SUPABASE_URL / ANON
#  - fill in SUPABASE_SERVICE_ROLE_KEY
#  - set GTLNAV_WORKER_SECRET to a hex string
#  - set GTLNAV_APP_URL=http://localhost:3000
#  - set NEXT_PUBLIC_GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR=1

# 3. apply migrations
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_core_identities.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_projects.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0003_deployments_and_queue.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0004_domains.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0005_infrastructure_logs.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0006_runtime_instances.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0007_docker_runtime.sql

# 4. start the control plane
npm run dev

# 5. start the worker in a second terminal
cd workers/deployment-worker
cp .env.example .env
#   GTLNAV_APP_URL=http://localhost:3000
#   GTLNAV_WORKER_SECRET=<same as the control plane>
#   DEPLOYMENTS_ROOT=<a writable local path>
npm install
npm start
```

Sign in to the dashboard, create a project that points at a public GitHub
repo with static output (e.g. a Vite SPA, a Next.js project with
`output: 'export'`, or a plain `index.html` site), and click **Deploy**.
The worker will claim the job, build it, publish to `DEPLOYMENTS_ROOT`,
and the dashboard will show real cloning / installing / building / running
status from the worker.

## Deploy to production (minimum viable)

1. **Database** — apply every file in `supabase/migrations/` in order. They
   are idempotent; rerunning is safe.

2. **Control plane** — host the Next.js app anywhere (Vercel, Fly, your
   own box). Set the env vars from `.env.example`. Make sure
   `NEXT_PUBLIC_GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR=1` is set in production
   so the legacy simulator can't accidentally drive deployments.

3. **Worker host** — provision a small Linux box with:

   - Node.js ≥ 20 and `git` on `PATH`
   - a writable `DEPLOYMENTS_ROOT` (e.g. `/var/gtlnav/deployments`)
   - the shared `GTLNAV_WORKER_SECRET`

   Run the worker as a systemd unit (see
   [`workers/deployment-worker/README.md`](workers/deployment-worker/README.md)).

4. **Reverse proxy** — install Caddy on the worker host (or on a separate
   proxy node sharing `DEPLOYMENTS_ROOT`). Drop in
   [`infra/caddy/Caddyfile.example`](infra/caddy/Caddyfile.example),
   replace `gtlnav.app` with your apex, point `*.<apex>` DNS at the
   proxy's public IP, and reload Caddy.

5. **Deploy something** — sign in, create a project, click Deploy.
   `https://<slug>.<apex>` will be live a couple of minutes later.

## Important environment variables

| Name | Where it's read | Purpose |
|------|-----------------|---------|
| `GTLNAV_APP_URL` | Worker + control plane | Public URL of the control plane. |
| `GTLNAV_WORKER_SECRET` | Worker + `authenticateWorker` | Shared secret for `/api/worker/*`. |
| `GTLNAV_PROXY_SECRET` | Caddy + control plane | Shared secret for `/api/proxy/*` (tls-ok, ssl-status, route-config). |
| `GTLNAV_DEPLOY_BASE_DOMAIN` | Worker + UI | Apex for project subdomains. |
| `DEPLOYMENTS_ROOT` | Worker + Caddy | Filesystem root where builds are published. |
| `GTLNAV_WORKER_DOCKER_ENABLED` | Worker | Master switch for the Phase 6B Docker code path. |
| `GTLNAV_WORKER_DOCKER_MEMORY` / `..._CPUS` | Worker | Per-container resource caps. |
| `GTLNAV_RUNTIME_PORT_MIN` / `..._MAX` | Worker | Internal-port window for Docker upstreams. |
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` | Control plane (browser + server) | Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Control plane (server only) | Bypasses RLS in API routes that need it. |
| `GITHUB_OAUTH_CLIENT_ID` / `..._SECRET` | Control plane | Real GitHub OAuth for repo imports. |
| `GTLNAV_TOKEN_ENCRYPTION_KEY` | Control plane | AES-256-GCM key for GitHub tokens. |
| `GITHUB_TOKEN` | Worker | Optional PAT used to clone private repos. |
| `GTLNAV_STRICT_AUTH_MIDDLEWARE` | Control plane | When `true`, gates `/dashboard` and `/admin` at the edge. |
| `NEXT_PUBLIC_GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR` | Control plane (browser + server) | Hard-disables the legacy simulator. |

## What's real, what's preview

Phase 6A made the deploy pipeline real end-to-end. Phase 6B adds **real
Docker/SSR runtime** and a control-plane-driven proxy:

| Surface | Status |
|---------|--------|
| Auth (Supabase) | ✅ real |
| GitHub OAuth + repo import | ✅ real |
| API keys / scopes / audit ledger | ✅ real |
| Deploy queue + worker + static publish | ✅ real |
| Docker runtime (Dockerfile, Next SSR, Express, Koa, Fastify, Hapi, Nest, npm start) | ✅ real (Phase 6B) |
| Runtime instance management (start/stop/restart/destroy) | ✅ real (queued through the worker, Phase 6B) |
| Proxy route config (`/api/proxy/route-config`) | ✅ real (Phase 6B) |
| TLS on-demand allowlist (`/api/proxy/tls-ok`) | ✅ real (Phase 6B) |
| SSL status callback (`/api/proxy/ssl-status`) | ✅ real (Phase 6B) |
| Domain DNS verification | ✅ real |
| SSL via Caddy on-demand TLS | ✅ real (proxy-driven, dashboard never fakes) |
| Edge functions | 🟡 preview — banner shown in UI |
| Infrastructure metrics | 🟡 preview — banner shown in UI |
| Analytics | 🟡 preview — banner shown in UI |
| Billing | ⛔ intentionally out of scope until Phase 7 |

The legacy simulator in `src/lib/deployment-simulator.ts` still exists for
dev / Storybook use but is hard-blocked by
`NEXT_PUBLIC_GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR=1` in production and
should not be imported from new UI code.

## Repo map

```
app/                       Next.js App Router (control plane UI + API)
src/components/            React UI
src/lib/                   Server + client libs
supabase/migrations/       Versioned SQL
workers/deployment-worker/ Node worker that builds + publishes
infra/caddy/               Sample reverse-proxy config
```
