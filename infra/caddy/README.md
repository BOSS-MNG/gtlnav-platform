# GTLNAV reverse proxy

GTLNAV uses [Caddy](https://caddyserver.com) as the public-facing reverse
proxy. Caddy was chosen because it:

- ships with automatic HTTPS (Let's Encrypt ACME) and on-demand TLS,
- has first-class wildcard / multi-domain handling,
- is a single static binary (easy to bake into any host).

> **For the full operator bring-up procedure (Phase 6D), follow
> [`infra/RUNBOOK.md`](../RUNBOOK.md). This file is the reference for the
> Caddy-specific files only.**

## Files

| File | Purpose |
|------|---------|
| `Caddyfile.example` | Sample config. Copy to `/etc/caddy/Caddyfile` and edit. |
| `refresh-routes.sh` | Polls `/api/proxy/route-config` and regenerates `/etc/caddy/routes.conf`. Schedule on a 30s timer. |
| `.env.example`      | Template for `/etc/gtlnav/caddy.env` loaded by the systemd timer. |

## Quick start

```bash
sudo bash infra/setup/install-caddy.sh         # installs Caddy + jq + sets dirs
sudo cp infra/caddy/Caddyfile.example /etc/caddy/Caddyfile
sudo $EDITOR /etc/caddy/Caddyfile               # edit emails + apex domain
sudo cp infra/caddy/.env.example /etc/gtlnav/caddy.env
sudo $EDITOR /etc/gtlnav/caddy.env              # paste GTLNAV_PROXY_SECRET
sudo systemctl reload caddy
sudo journalctl -fu caddy
```

## DNS expectations

For project subdomains under `<slug>.gtlnav.app` you need:

```
*.gtlnav.app   A     <public-ip-of-the-caddy-host>
```

For custom domains added through the dashboard, the user creates:

```
app.example.com   CNAME   <slug>.gtlnav.app
```

`/api/domains/:id/verify` checks for exactly that CNAME with
`node:dns/promises` before promoting the row to `verified`. Caddy's
on-demand TLS handler asks `/api/proxy/tls-ok` whether to obtain a cert
for that hostname.

## SSL state machine

| State | Meaning | Set by |
|-------|---------|--------|
| `pending_dns` | Waiting on the user's CNAME / A record to resolve. | Control plane (default for new domains). |
| `pending_ssl` | DNS verified; Caddy is performing ACME. | `/api/domains/:id/ssl-request` after `verified`. |
| `issued` | Cert obtained and being served. | Caddy or proxy callback to `/api/proxy/ssl-status` — never the dashboard. |
| `ssl_failed` | Caddy reported an ACME failure. | `/api/proxy/ssl-status` callback. |
| `disabled` | Operator paused TLS for this domain. | Manual SQL / admin tool. |

The dashboard **never** flips `ssl_status` to `issued` directly — that
guarantee is enforced in `src/components/domains/domains-client.tsx`.

## Dynamic route refresh

The control plane keeps the authoritative route table in `proxy_routes`. The
proxy reads it through `/api/proxy/route-config` and rewrites
`/etc/caddy/routes.conf` (imported by `Caddyfile.example`).

The production-ready timer + service units live in
[`infra/systemd/`](../systemd/). Install them with:

```bash
sudo cp infra/systemd/gtlnav-routes-refresh.service /etc/systemd/system/
sudo cp infra/systemd/gtlnav-routes-refresh.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gtlnav-routes-refresh.timer
```

The unit reads `/etc/gtlnav/caddy.env` (template:
[`infra/caddy/.env.example`](./.env.example)). The secret is **only** ever
sent in the `x-gtlnav-proxy-secret` header.

