# GTLNAV deployment worker

A small Node.js process that turns queued `deployment_jobs` rows into real
static deployments on disk. It is the **only** thing that calls
`/api/worker/*` in the GTLNAV control plane.

## What it does (Phase 6A + 6B)

1. Polls `POST /api/worker/claim-job` with the shared worker secret.
2. The worker discriminates by `payload.kind`:

   ### `kind = 'deploy'` (default / Phase 6A + Phase 6B)
   1. clones the project's GitHub repo (depth 1, requested branch)
   2. detects hosting kind:
      - **static** — Next export, Vite, CRA, Astro, Nuxt-generate, plain HTML
      - **docker** — Dockerfile in repo, Next SSR, Express, Koa, Fastify, Hapi, Nest, generic `npm start`
   3. **static path**:
      - runs install + build with `npm` / `pnpm` / `yarn` (never via shell)
      - copies the static output into `$DEPLOYMENTS_ROOT/<project_slug>/<deployment_id>/`
      - atomically flips `$DEPLOYMENTS_ROOT/<project_slug>/current`
   4. **docker path** (Phase 6B):
      - allocates a loopback port from `GTLNAV_RUNTIME_PORT_{MIN,MAX}`
      - if no Dockerfile, writes one from a safe template (Next SSR or generic Node)
      - `docker build -t gtlnav/<slug>:<deployment_id>`
      - `docker run -d --rm --read-only --cap-drop ALL --security-opt no-new-privileges --memory $MEM --cpus $CPUS -p 127.0.0.1:<port>:<port>/tcp`
      - HTTP probe `http://127.0.0.1:<port>/` until 2xx/3xx or timeout
      - tears down the container if it never becomes healthy
   5. registers/updates `runtime_instances` and `proxy_routes` via
      `POST /api/worker/runtime-instance` and `POST /api/worker/route-register`

   ### `kind = 'runtime_action'` (Phase 6B)
   - When the user clicks Start / Stop / Restart / Destroy in the dashboard,
     the control plane enqueues a job with `payload.kind = 'runtime_action'`.
   - The worker runs the corresponding docker subcommand and updates
     `runtime_instances.target_state` + `last_action`.

3. Streams stdout + stderr to `POST /api/worker/logs` in batches.
4. Reports phase transitions to `POST /api/worker/status`.
5. Calls `POST /api/worker/complete` or `POST /api/worker/fail` on exit.

## What it does **not** do

- It does **not** issue SSL certificates. The reverse proxy (Caddy) does
  that via ACME on-demand TLS. The proxy then calls
  `POST /api/proxy/ssl-status` to mark domains as `issued` / `ssl_failed`.
- It does **not** trust user-supplied build / docker commands blindly —
  see *Security* below.
- It does **not** mount user paths into containers. Only `/tmp` is provided
  as a 64MB tmpfs.

## Prerequisites

- Node.js ≥ 20 with `git` available on `PATH`.
- For Phase 6B docker support: Docker Engine ≥ 24 with the `docker` CLI
  on `PATH`. Run `docker version` from the worker user to confirm.
- A control-plane URL reachable from this host.
- A shared worker secret (also set on the control plane as
  `GTLNAV_WORKER_SECRET`).
- Migrations applied:
  - `0003_deployments_and_queue.sql` (queue)
  - `0006_runtime_instances.sql` (runtime tracking)
  - `0007_docker_runtime.sql` (Phase 6B columns + `proxy_routes`)

## Install + run (local)

```bash
cd workers/deployment-worker
cp .env.example .env       # then fill in the values
npm install
npm start                  # long-running loop
# or
npm run start:once         # claim a single job and exit
```

The worker prints `[worker] gtlnav-deployment-worker starting…` once
config validation passes. Logs for each job are mirrored to local stderr
with `[level] [source]` prefixes.

## Run as a system service (Linux)

The production-ready unit lives at
[`infra/systemd/gtlnav-worker.service`](../../infra/systemd/gtlnav-worker.service).
It expects the worker checkout at `/opt/gtlnav/worker` and its env file at
`/etc/gtlnav/worker.env`. Install with:

```bash
sudo cp infra/systemd/gtlnav-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gtlnav-worker
sudo journalctl -fu gtlnav-worker
```

For the full host bring-up (Docker, Caddy, DNS, systemd, log rotation,
prune jobs), see [`infra/RUNBOOK.md`](../../infra/RUNBOOK.md).

## Security

- Build commands are tokenized and the binary must be one of
  `npm`, `pnpm`, `yarn`, or `node`. Shell metacharacters (`&;|\`$<>`) are
  rejected. The worker never invokes `bash -c`.
- Docker subcommands are limited to an allowlist
  (`build / run / start / stop / restart / rm / logs / inspect / ps / kill / version`).
  All other subcommands are refused before reaching the daemon.
- Containers run with `--rm`, `--read-only`, `--cap-drop ALL`,
  `--security-opt no-new-privileges:true`, `--pids-limit 256`, capped
  memory/CPU, and only `127.0.0.1:<port>` exposed (no public bind).
- Only the runtime port range is exposed externally — never the daemon
  socket.
- The shared worker secret and any GitHub token are redacted from log
  lines before they are sent to the control plane.
- The repo is cloned into `os.tmpdir()`/gtlnav-build-* and removed at
  the end of every run, regardless of success or failure.
- `node_modules` is **not** copied to `DEPLOYMENTS_ROOT`; only the build
  output directory is published.

## Configuration

See `.env.example` for the full list. Most defaults are sensible; the
only values you must set are:

| Variable | Required | What for |
|----------|----------|----------|
| `GTLNAV_APP_URL` | yes | Base URL of the control plane |
| `GTLNAV_WORKER_SECRET` | yes | Shared secret matching the control plane |
| `GTLNAV_DEPLOY_BASE_DOMAIN` | recommended | Apex domain used for project URLs |
| `DEPLOYMENTS_ROOT` | recommended | Where the proxy serves files from |
| `GITHUB_TOKEN` | for private repos | Fine-grained PAT (read-only contents) |
| `GTLNAV_WORKER_DOCKER_ENABLED` | yes (Phase 6B) | `true` enables the docker code path |
| `GTLNAV_WORKER_DOCKER_MEMORY` | recommended | Per-container memory cap (default 512m) |
| `GTLNAV_WORKER_DOCKER_CPUS` | recommended | Per-container CPU cap (default 0.5) |
| `GTLNAV_RUNTIME_PORT_MIN/MAX` | yes (Phase 6B) | Internal port window for docker containers |
| `GTLNAV_WORKER_HEALTH_TIMEOUT_MS` | optional | Health budget after `docker run` |
