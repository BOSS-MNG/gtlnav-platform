# GTLNAV — operations scripts

| Script | What it does |
|--------|--------------|
| `smoke-test-deploy.sh` | E2E static-deploy smoke test (bash/jq). Verifies `runtime_instances`. |
| `smoke-test-deploy.ps1` | Same, PowerShell flavour. |
| `smoke-test-docker.sh`  | E2E Docker-deploy smoke test (bash/jq). Verifies container metadata + health. |
| `reset-build.ps1` | Wipes `.next` and reinstalls dependencies. |
| `build-favicons.ps1` | Regenerates branded favicons from the source SVG. |

See [`infra/RUNBOOK.md`](../infra/RUNBOOK.md) for the full Phase 6D
operations bring-up procedure (Docker, Caddy, systemd, DNS, log rotation,
prune jobs). The smoke tests below assume that runbook is already done.

## Smoke test prerequisites

1. Apply migrations through 0007.
2. Start the control plane (`npm run dev` or production server).
3. Start the deployment worker (`workers/deployment-worker`, `npm start`).
4. Create a project in the dashboard, attach a public Git repo.
5. Mint a long-lived API key with `deployments:write`.

Bash:

```bash
export GTLNAV_APP_URL=http://localhost:3000
export GTLNAV_API_KEY=gtlnav_live_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxx
export GTLNAV_PROJECT_ID=<uuid>
./scripts/smoke-test-deploy.sh
```

PowerShell:

```powershell
$env:GTLNAV_APP_URL = "http://localhost:3000"
$env:GTLNAV_API_KEY = "gtlnav_live_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxx"
$env:GTLNAV_PROJECT_ID = "<uuid>"
./scripts/smoke-test-deploy.ps1
```

Expected output: the script polls status every 5s and exits 0 when
`status === 'active'`. If the worker fails, the last reported `status` and
`error_message` are printed.

## Docker smoke test

Use `smoke-test-docker.sh` once the worker host has Docker installed
(`docker version` succeeds) and at least 1.5 GB free. The script does the
same thing as the static one plus asserts that `runtime_kind`,
`container_name`, `container_id`, `internal_port`, and
`last_health_status` are populated.

```bash
export GTLNAV_APP_URL=https://app.gtlnav.godtechlabs.com
export GTLNAV_API_KEY=gtlnav_live_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxx
export GTLNAV_PROJECT_ID=<uuid of a project pointed at a Dockerfile / Express / Next-SSR repo>
./scripts/smoke-test-docker.sh
```

The worker will:

- clone the repo
- detect the framework and pick the `docker` path
- generate a Node / Next.js Dockerfile from `workers/deployment-worker/src/templates/`
  (or use the repo's own Dockerfile if present)
- `docker build` and tag `gtlnav/<slug>:<deployment_id>`
- `docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges \
       --memory 512m --cpus 0.5 -p 127.0.0.1:<port>:<port>/tcp ...`
- HTTP probe `http://127.0.0.1:<port>/` until 2xx/3xx
- upsert `runtime_instances` with `runtime_kind = 'docker'`
- register `proxy_routes` with `upstream_kind = 'docker'`

With Caddy + `infra/systemd/gtlnav-routes-refresh.timer` running, the
deployment URL becomes live within ~30 seconds of the worker reporting
`Deployment live at https://<slug>.<base-domain>`.
