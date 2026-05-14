# GTLNAV production deploy hardening

This bundle secures the **existing** VPS deployment flow:

```text
GitHub -> webhook listener (:9000) -> deploy.sh -> PM2 reload -> live site
```

It is intentionally **additive**. Nothing in the Next.js control plane, nginx,
or Caddy routing changes when these files are added to the repo. The live site
only changes when you install this bundle on the VPS and point PM2 at it.

## Files

| File | Purpose |
|------|---------|
| `deploy-webhook-server.mjs` | GitHub webhook receiver with `X-Hub-Signature-256` verification. |
| `deploy.sh` | Safe deployment script with lock file, staging build, PM2 reload, and rollback. |
| `redact-log-stream.mjs` | Redacts secret values from deployment logs. |
| `ecosystem.config.cjs` | PM2 app + webhook process template. |
| `.env.example` | Server-only environment template. |

## Security guarantees

### Webhook verification

- `X-Hub-Signature-256` is **required**
- unsigned requests are rejected
- invalid signatures are rejected
- signature comparison uses `timingSafeEqual`
- secret comes from `GTLNAV_WEBHOOK_SECRET`

### Deploy access lockdown

`deploy.sh` is hardcoded to:

- fetch `origin/main` only
- refuse any repo whose `origin` remote is not `godtechlabs/gtlnav-platform`
- run a fixed command set only:
  - `git fetch`
  - `git checkout`
  - `git reset --hard`
  - `npm ci`
  - `npm run build`
  - `pm2 reload`

There is no `eval`, no user-supplied shell, and no arbitrary branch input.

### Safe deploy behavior

- `set -Eeuo pipefail`
- lock directory prevents overlapping deployments
- deployment logs go to `~/deploy-logs/deploy-YYYY-MM-DD-HH-MM.log`
- staging clone must build successfully before the live tree is touched
- PM2 reload happens **only after** the live build succeeds
- if PM2 reload fails after the live tree changed, the script resets to the
  previous commit and rebuilds it

### Environment security

- `.env.local` is already covered by the repo root `.gitignore` via `.env*`
- `deploy.sh` never prints webhook secrets
- `redact-log-stream.mjs` masks sensitive values found in process env and
  `.env.local`
- this bundle does not add any new browser-side env usage

## Temporary port 9000 mode vs future nginx mode

### Current temporary mode

The listener can bind `0.0.0.0:9000` and accept GitHub webhooks directly:

```text
GitHub -> http://gtlnav.godtechlabs.com:9000/hooks/gtlnav-deploy
```

This keeps the current deployment path working while you harden it.

### Future hardened mode

Move the listener behind nginx:

```text
GitHub -> https://gtlnav.godtechlabs.com/hooks/gtlnav-deploy
            nginx reverse_proxy -> 127.0.0.1:9000
```

Once that is in place:

- set `GTLNAV_DEPLOY_WEBHOOK_HOST=127.0.0.1`
- close port `9000` in the firewall
- keep HTTPS termination and request filtering at nginx

## PM2 usage

Example:

```bash
cd /var/www/gtlnav
chmod +x infra/production/deploy.sh
cp infra/production/.env.example /etc/gtlnav/deploy-webhook.env
$EDITOR /etc/gtlnav/deploy-webhook.env

export $(grep -v '^#' /etc/gtlnav/deploy-webhook.env | xargs)
pm2 start infra/production/ecosystem.config.cjs
pm2 save
```

If you already have a running GTLNAV PM2 app process, set
`GTLNAV_PM2_APP_NAME` to that exact process name before using `deploy.sh`.

## Deploy success footer

Every successful deployment ends with:

```text
✅ GTLNAV deployment successful
commit: <sha>
time: <timestamp>
```
