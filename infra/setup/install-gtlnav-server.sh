#!/usr/bin/env bash
# GTLNAV — provision system user, directories, and permissions for the
# worker + Caddy stack on a single VPS host.
#
# Idempotent. Safe to re-run.
#
#   sudo bash infra/setup/install-gtlnav-server.sh
#
# What this creates:
#   /opt/gtlnav/                 owned by gtlnav:gtlnav, holds worker + scripts
#   /var/gtlnav/deployments/     owned by gtlnav:caddy, world-readable
#   /var/log/gtlnav/             worker + ops logs
#   /etc/gtlnav/                 environment files (caddy.env, worker.env)
#
# Adds the `gtlnav` system user to the `docker` group so it can drive the
# daemon without root.
#
# Does NOT install Docker or Caddy. Run install-docker.sh and install-caddy.sh
# first.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[gtlnav] install-gtlnav-server.sh must run as root." >&2
  exit 1
fi

GTLNAV_USER="${GTLNAV_USER:-gtlnav}"
GTLNAV_HOME="${GTLNAV_HOME:-/opt/gtlnav}"
DEPLOYMENTS_ROOT="${DEPLOYMENTS_ROOT:-/var/gtlnav/deployments}"

if ! getent passwd "$GTLNAV_USER" >/dev/null; then
  echo "[gtlnav] Creating system user '$GTLNAV_USER'…"
  useradd --system --create-home --home-dir "$GTLNAV_HOME" \
    --shell /usr/sbin/nologin "$GTLNAV_USER"
else
  echo "[gtlnav] System user '$GTLNAV_USER' already exists."
fi

# Add to docker group so the worker can issue `docker build` / `docker run`.
if getent group docker >/dev/null; then
  if ! id -nG "$GTLNAV_USER" | tr ' ' '\n' | grep -qx docker; then
    echo "[gtlnav] Adding $GTLNAV_USER to the docker group…"
    usermod -aG docker "$GTLNAV_USER"
  fi
else
  echo "[gtlnav] WARN — docker group not present. Install Docker before this script." >&2
fi

echo "[gtlnav] Creating directories…"
install -d -m 0755 -o "$GTLNAV_USER" -g "$GTLNAV_USER" "$GTLNAV_HOME"
install -d -m 0755 -o "$GTLNAV_USER" -g "$GTLNAV_USER" /var/log/gtlnav
install -d -m 0755 -o root -g root /etc/gtlnav

# DEPLOYMENTS_ROOT must be readable by Caddy and writable by the worker.
# Best layout: gtlnav owns it; caddy group reads it; others have execute on
# parent dirs so Caddy can traverse.
install -d -m 0755 -o root -g root /var/gtlnav
install -d -m 0755 -o "$GTLNAV_USER" -g "$GTLNAV_USER" "$DEPLOYMENTS_ROOT"

if getent group caddy >/dev/null; then
  chgrp -R caddy "$DEPLOYMENTS_ROOT" || true
  chmod -R g+rX "$DEPLOYMENTS_ROOT"
fi

# /etc/caddy/routes.conf is owned by root (matches how install-caddy.sh
# creates it). The refresh-routes systemd unit also runs as root and
# atomically swaps the file, so we just normalize permissions here so an
# operator who ran the install scripts in a different order still ends up
# with the right ownership for `caddy validate` / `caddy reload`.
if [[ -f /etc/caddy/routes.conf ]]; then
  echo "[gtlnav] Normalizing /etc/caddy/routes.conf ownership…"
  chown root:"$GTLNAV_USER" /etc/caddy/routes.conf
  chmod 0664 /etc/caddy/routes.conf
fi

echo "[gtlnav] Directory layout:"
ls -ld "$GTLNAV_HOME" /var/gtlnav "$DEPLOYMENTS_ROOT" /var/log/gtlnav /etc/gtlnav

echo "[gtlnav] Done."
echo "  Next steps:"
echo "    1. Copy infra/caddy/Caddyfile.example to /etc/caddy/Caddyfile and edit emails/apex."
echo "    2. Drop /etc/gtlnav/worker.env (mirrors workers/deployment-worker/.env.example)."
echo "    3. Drop /etc/gtlnav/caddy.env (mirrors infra/caddy/.env.example)."
echo "    4. Install systemd units:  cp infra/systemd/*.service infra/systemd/*.timer /etc/systemd/system/"
echo "    5. systemctl daemon-reload && systemctl enable --now gtlnav-worker gtlnav-routes-refresh.timer"
