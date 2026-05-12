# GTLNAV — Phase 6D Operator Runbook

Bring GTLNAV up on a real Ubuntu 22.04 / 24.04 VPS and validate that it
honestly hosts both static sites and Docker containers over HTTPS.

This runbook is the single source of truth for the operator-side of Phase 6D.
Everything below has been mechanically prepared by the codebase — your job is
to execute the commands in order, paste the listed outputs back into the
Phase 6D report, and stop when something doesn't match.

> If a step's output doesn't match what's listed here, **stop and debug
> there**. Do not skip ahead to make it look successful.

---

## 0. What you need before you start

| Item | Minimum |
|------|---------|
| Ubuntu 22.04 LTS or 24.04 LTS VPS | 4 vCPU, 8 GB RAM, 80 GB SSD |
| Root SSH access | yes |
| Public IPv4 | yes (IPv6 optional but recommended) |
| Apex domain you control | e.g. `gtlnav.godtechlabs.com` |
| Wildcard DNS managed by you | `*.gtlnav.godtechlabs.com` → VPS IP |
| Supabase project | with all migrations 0001–0008 applied |
| Stripe / billing | NOT required for Phase 6D |

Decide and write down the values you will use:

```text
GTLNAV_APP_URL              = https://app.gtlnav.godtechlabs.com
GTLNAV_DEPLOY_BASE_DOMAIN   = gtlnav.godtechlabs.com
GTLNAV_WORKER_SECRET        = $(openssl rand -hex 32)
GTLNAV_PROXY_SECRET         = $(openssl rand -hex 32)
GTLNAV_TOKEN_ENCRYPTION_KEY = $(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
DEPLOYMENTS_ROOT            = /var/gtlnav/deployments
```

The control plane (Next.js) can run on the same VPS as the worker + Caddy, or
on a managed host like Vercel/Fly. The runbook below assumes a single-VPS
layout where everything lives on one box. Splitting across multiple hosts is
covered in §11.

---

## 1. Required ports

| Port | Direction | Purpose | Open in firewall? |
|------|-----------|---------|-------------------|
| 22 | inbound | SSH | yes (recommended: lock to your IP) |
| 80 | inbound | HTTP — ACME challenges + redirects | yes |
| 443 | inbound | HTTPS — Caddy serves all sites | yes |
| 34000–34999 | localhost only | Docker container ports (worker binds 127.0.0.1) | **no** — must stay closed |
| outbound 443 | outbound | Supabase, GitHub, Docker Hub, control plane API | yes |

UFW example:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Confirm 34000-34999 are **not** listed in "allow" rules — the worker binds
those to `127.0.0.1` only, and Caddy reverse-proxies through localhost.

---

## 2. DNS records

Set these on your authoritative DNS (Cloudflare, Route 53, etc.):

| Type | Name | Value | TTL | Proxied? |
|------|------|-------|-----|----------|
| A | `gtlnav.godtechlabs.com` | `<VPS public IPv4>` | 300 | no (DNS-only if Cloudflare) |
| A | `*.gtlnav.godtechlabs.com` | `<VPS public IPv4>` | 300 | no |
| A | `app.gtlnav.godtechlabs.com` | `<control plane public IPv4>` | 300 | yes if behind CF |
| AAAA (optional) | `gtlnav.godtechlabs.com` | `<VPS public IPv6>` | 300 | no |

Verify before continuing:

```bash
dig +short A gtlnav.godtechlabs.com
dig +short A 'foo.gtlnav.godtechlabs.com'    # wildcard
dig +short A app.gtlnav.godtechlabs.com
```

All three queries must return your expected IPs. If the wildcard is empty,
Caddy's ACME challenge will fail later — fix this first.

---

## 3. Install the host stack

All install scripts are **idempotent**. Re-running them is safe.

```bash
# Clone the repo somewhere on the VPS.
sudo git clone https://github.com/godtechlabs/gtlnav-platform.git /opt/gtlnav
cd /opt/gtlnav

# 3.1 Docker
sudo bash infra/setup/install-docker.sh

# 3.2 Caddy
sudo bash infra/setup/install-caddy.sh

# 3.3 GTLNAV system user + directories + permissions
sudo bash infra/setup/install-gtlnav-server.sh

# 3.4 Build the worker
sudo -u gtlnav bash -c 'cd /opt/gtlnav/workers/deployment-worker && npm ci --omit=dev'
```

Confirm each step succeeded:

```bash
docker --version          # expect Docker version 26.x or newer
caddy version             # expect v2.7+ (with on_demand_tls)
id gtlnav                 # gtlnav must be in `docker` group
ls -ld /var/gtlnav/deployments  # owner: gtlnav, group: caddy
```

---

## 4. Configure environment

```bash
# 4.1 Control plane — only needed if you run Next.js on this VPS.
sudo cp /opt/gtlnav/.env.production.example /opt/gtlnav/.env.production
sudo $EDITOR /opt/gtlnav/.env.production
sudo chmod 0640 /opt/gtlnav/.env.production
sudo chown gtlnav:gtlnav /opt/gtlnav/.env.production

# 4.2 Worker
sudo cp /opt/gtlnav/workers/deployment-worker/.env.example /etc/gtlnav/worker.env
sudo $EDITOR /etc/gtlnav/worker.env
sudo chmod 0640 /etc/gtlnav/worker.env
sudo chown root:gtlnav /etc/gtlnav/worker.env

# 4.3 Caddy (proxy callbacks)
sudo cp /opt/gtlnav/infra/caddy/.env.example /etc/gtlnav/caddy.env
sudo $EDITOR /etc/gtlnav/caddy.env
sudo chmod 0640 /etc/gtlnav/caddy.env
sudo chown root:root /etc/gtlnav/caddy.env
```

Critical sanity check: `GTLNAV_WORKER_SECRET` and `GTLNAV_PROXY_SECRET` must
be **identical** across the worker host, the Caddy host, AND the control
plane. The control plane uses constant-time compare on every incoming
request — a single off-by-one character returns 401 silently.

---

## 5. Caddy production config

```bash
# 5.1 Replace the placeholder Caddyfile.
sudo cp /opt/gtlnav/infra/caddy/Caddyfile.example /etc/caddy/Caddyfile

# 5.2 Edit the apex domain + email if you didn't use gtlnav.app.
sudo $EDITOR /etc/caddy/Caddyfile
#   replace `email ops@gtlnav.app` with your real ops email
#   replace `*.gtlnav.app` with `*.gtlnav.godtechlabs.com` (your apex)
#   replace `https://app.gtlnav.app/api/proxy/tls-ok`
#       with `https://app.gtlnav.godtechlabs.com/api/proxy/tls-ok`

# 5.3 Make the routes file writable by the gtlnav group.
sudo chown root:gtlnav /etc/caddy/routes.conf
sudo chmod 0664 /etc/caddy/routes.conf

# 5.4 Validate.
sudo caddy validate --config /etc/caddy/Caddyfile

# 5.5 Reload (do NOT restart; reload swaps config without downtime).
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

If `caddy validate` complains about `import /etc/caddy/routes.conf`, that
file may be empty — that is fine. The first run of the routes refresh
(§7) will populate it.

---

## 6. Install systemd units

```bash
sudo cp /opt/gtlnav/infra/systemd/gtlnav-worker.service /etc/systemd/system/
sudo cp /opt/gtlnav/infra/systemd/gtlnav-routes-refresh.service /etc/systemd/system/
sudo cp /opt/gtlnav/infra/systemd/gtlnav-routes-refresh.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now gtlnav-worker
sudo systemctl enable --now gtlnav-routes-refresh.timer
```

Verify:

```bash
sudo systemctl status gtlnav-worker --no-pager
sudo systemctl list-timers gtlnav-routes-refresh.timer --no-pager
sudo journalctl -u gtlnav-worker -n 50 --no-pager
```

The worker journal should print on boot:

```
[worker] gtlnav-deployment-worker starting. label=… app=… deployments_root=/var/gtlnav/deployments
```

If it loops with `Auth error from control plane: Unauthorized`, your worker
secret does not match the control plane. Fix step 4 and `systemctl restart
gtlnav-worker`.

---

## 7. Verify routes refresh

```bash
# Trigger one refresh immediately so we see the result.
sudo systemctl start gtlnav-routes-refresh.service
sudo journalctl -u gtlnav-routes-refresh -n 30 --no-pager
sudo cat /etc/caddy/routes.conf
```

You should see one of:

| Outcome | Meaning |
|---------|---------|
| `routes.conf unchanged.` | No active routes yet (expected on a fresh install). |
| `routes.conf updated; caddy reloaded.` | The control plane returned at least one route. |
| `route-config returned HTTP 401` | `GTLNAV_PROXY_SECRET` does not match. Fix /etc/gtlnav/caddy.env. |
| `route-config returned HTTP 503` | `proxy_routes` table missing — apply migration `0007_docker_runtime.sql`. |

---

## 8. First real STATIC deploy (Phase 6D.4)

1. In the GTLNAV dashboard, create a project pointing at a small static repo
   (the [Vercel `next-static-export` sample](https://github.com/vercel/next.js/tree/canary/examples/with-static-export)
   works; CRA, Vite, Astro all work too).
2. Set:
   - `runtime_kind = auto` or `static`
   - `build_command = build`
   - `build_output_dir = out` (or `dist`, depending on framework)
3. Click **Deploy**, OR run the smoke script from any machine that has the
   GTLNAV API key:

```bash
GTLNAV_APP_URL=https://app.gtlnav.godtechlabs.com \
GTLNAV_API_KEY=gtlnav_live_pat_… \
GTLNAV_PROJECT_ID=<uuid-from-dashboard> \
bash /opt/gtlnav/scripts/smoke-test-deploy.sh
```

Expected timeline (from the worker journal):

```text
runner   Worker "static-worker-1" claimed deployment job …
clone    git clone …
detect   Hosting kind resolved: static (next-static).
install  Installing dependencies (npm ci)…
build    Running build (npm run build)…
publish  Publishing static bundle…
publish  Deployment live at https://<slug>.gtlnav.godtechlabs.com
```

Verify rows landed in the database (run from your machine):

```bash
curl -sS "https://app.gtlnav.godtechlabs.com/api/runtime/instances" \
  -H "Authorization: Bearer $GTLNAV_API_KEY" | jq '.instances[0]'

# Expect runtime_kind="static", status="running", serve_path set,
# framework="next-static" (or whatever was detected).
```

Open the live URL in a browser:

```text
https://<slug>.gtlnav.godtechlabs.com
```

First load may take ~5–15 seconds while Caddy obtains the SSL cert from
Let's Encrypt. Subsequent loads are immediate.

---

## 9. First real DOCKER deploy (Phase 6D.5)

Pick a public repo with **one** of the following:

| Pattern | Example repo |
|---------|--------------|
| Dockerfile in the repo root | https://github.com/docker/welcome-to-docker |
| `express` in `package.json` | any minimal Express server |
| Next.js without `output: 'export'` | any default `create-next-app` |

Create a second project in GTLNAV pointing at it. Set `runtime_kind = auto`
(or `docker` to force the path). Click **Deploy**.

Expected worker journal:

```text
detect   Hosting kind resolved: docker (express).
docker   Allocated internal port 127.0.0.1:34001.
docker   Wrote autogenerated Dockerfile (Dockerfile.node.txt) — node 20-alpine, PORT=34001.
docker   Building image gtlnav/<slug>:<deploymentId>…
docker-build … build output …
docker   Starting container gtlnav-<slug>-<deploymentId>…
docker-run …
docker   Health probe http://127.0.0.1:34001/ → 200 OK.
publish  Docker deployment live at https://<slug>.gtlnav.godtechlabs.com
```

On the VPS:

```bash
docker ps --filter "label=gtlnav=1" --format \
  "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
# Expect a single row: name starts with `gtlnav-`, port maps 127.0.0.1:<port>.
```

In the database (same `/api/runtime/instances` query):

```text
{
  "runtime_kind": "docker",
  "status": "running",
  "target_state": "running",
  "container_name": "gtlnav-<slug>-<deploymentId>",
  "container_id": "...",
  "internal_port": 34001,
  "image_tag": "gtlnav/<slug>:<deploymentId>",
  "last_health_status": "healthy",
  "framework": "express"
}
```

Open the live URL — the response is the container's, served through Caddy
with HTTPS terminated at the proxy.

---

## 10. Runtime actions (Phase 6D.6)

From the runtime dashboard, on the Docker row from §9, click each button in
turn. Then verify via:

| Action | `/api/runtime/instances` should show | `docker ps` should show |
|--------|--------------------------------------|--------------------------|
| Stop | `status=stopped`, `target_state=stopped`, `last_action=stop` | container in `Exited` state OR gone (if `--rm`) |
| Start | `status=running`, `target_state=running`, `last_action=start` | container `Up` |
| Restart | `status=running`, `last_action=restart`, `last_action_at` updated | container `Up`, new `StartedAt` |
| Destroy | `status=failed`, `target_state=destroyed`, `last_action=destroy` | container gone, image still cached |

After Destroy, the proxy_routes row for the hostname must flip to
`status=disabled`. Verify by re-curling `/api/proxy/route-config` from the
Caddy host — the hostname disappears from the active route list, and within
30 seconds Caddy stops accepting on-demand TLS for it.

---

## 11. Failure tests (Phase 6D.7)

Run each of these and check the worker journal + the project's deployment
status returns `failed` with a real, specific message. Honest failure is
the goal — fake-success is forbidden.

| Test | What to provoke | Expected stage in `infrastructure_logs.metadata.stage` |
|------|-----------------|---------------------------------------------------------|
| Invalid repo | Set `repo_url=https://github.com/this/does-not-exist` | `clone` |
| Broken Dockerfile | Point at a repo whose `Dockerfile` has a deliberate `RUN exit 1` | `docker_build` |
| Failed npm install | Repo whose `package.json` has a bogus dependency version | `install` |
| Failed build | Repo whose `npm run build` throws | `build` |
| Health check timeout | Express app that listens on the wrong port (`3001` instead of `$PORT`) | `health` |
| Container crash on boot | Container whose `CMD` exits 1 immediately | `docker_run` or `health` |

For each, the dashboard must show the deployment as **Failed** (red), and
the worker's journal must contain the actual error message — never a
silent success.

---

## 12. Cleanup

Install the prune scripts so disk usage doesn't grow forever:

```bash
sudo cp /opt/gtlnav/infra/cleanup/gtlnav.logrotate /etc/logrotate.d/gtlnav
sudo logrotate -d /etc/logrotate.d/gtlnav   # dry-run; confirm no errors

# Optional: cron the disk pruning jobs.
sudo crontab -e
# Add:
#   0 3 * * *  /opt/gtlnav/infra/cleanup/prune-deployments.sh  >/var/log/gtlnav/prune-deployments.log 2>&1
#   30 3 * * * /opt/gtlnav/infra/cleanup/prune-docker.sh       >/var/log/gtlnav/prune-docker.log 2>&1
```

Recommended thresholds:

| Resource | Action | Trigger |
|----------|--------|---------|
| `DEPLOYMENTS_ROOT` disk | `prune-deployments.sh KEEP=10` | every 24h |
| Docker images | `prune-docker.sh` | every 24h |
| Caddy access logs | journald defaults | journald rotates automatically |
| Worker logs | logrotate config above | daily, keep 14 |
| Supabase backups | enable Supabase point-in-time recovery | continuous |

---

## 13. Splitting across multiple hosts (optional)

If the control plane (Next.js) lives on Vercel and only the worker + Caddy
live on the VPS:

| Component | Where it runs | What it reaches |
|-----------|---------------|------------------|
| Next.js (control plane) | Vercel / Fly | Supabase only |
| Caddy + refresh-routes timer | VPS | `https://app.gtlnav.godtechlabs.com/api/proxy/*` (over the internet) |
| Worker | VPS | `https://app.gtlnav.godtechlabs.com/api/worker/*` (over the internet) |
| `DEPLOYMENTS_ROOT` | VPS only | local FS |

In that mode, `GTLNAV_APP_URL` on the VPS points at the public control
plane URL. Latency between worker → control plane is fine up to ~200 ms.

---

## 14. Hand-off checklist

Before declaring Phase 6D done, paste the following into the Phase 6D
report. Empty / unknown values mean the step was not actually executed.

```text
VPS provider:               __________________________
VPS specs:                  __ vCPU / __ GB RAM / __ GB SSD
Ubuntu version:             __________________________
Docker version:             $(docker --version)
Caddy version:              $(caddy version | head -1)
DNS apex:                   __________________________
DNS wildcard verified:      yes / no
HTTPS working on apex:      yes / no
HTTPS working on wildcard:  yes / no

Static smoke test (§8):
  deployment_id:            ______________
  duration_ms:              ______________
  runtime_instance.id:      ______________
  runtime_instance.status:  running / stopped / failed
  proxy_route.hostname:     ______________
  URL response code:        ______________

Docker smoke test (§9):
  deployment_id:            ______________
  duration_ms:              ______________
  runtime_instance.id:      ______________
  container_name:           ______________
  internal_port:            ______________
  image_tag:                ______________
  last_health_status:       ______________
  URL response code:        ______________

Runtime actions (§10):
  start: PASS / FAIL  notes: ______________
  stop:  PASS / FAIL  notes: ______________
  restart: PASS / FAIL  notes: ______________
  destroy: PASS / FAIL  notes: ______________

Failure tests (§11):
  invalid_repo:  failed_at=clone   PASS / FAIL
  broken_dockerfile: failed_at=docker_build  PASS / FAIL
  failed_install: failed_at=install  PASS / FAIL
  failed_build: failed_at=build  PASS / FAIL
  health_timeout: failed_at=health  PASS / FAIL
  container_crash: failed_at=docker_run/health  PASS / FAIL

Pruning jobs scheduled:     yes / no
Logrotate installed:        yes / no
Supabase backups enabled:   yes / no
```

When every line is filled in, Phase 6D is done.
