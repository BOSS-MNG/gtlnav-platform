#!/usr/bin/env bash
# GTLNAV — install Docker Engine on Ubuntu 22.04 / 24.04 LTS.
#
# Idempotent. Re-running on a host that already has Docker is a no-op.
#
# Run as root (or with sudo):
#   sudo bash infra/setup/install-docker.sh
#
# What this does:
#   1. Removes any old docker / containerd / runc packages.
#   2. Adds Docker's official APT repository.
#   3. Installs docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin,
#      docker-compose-plugin.
#   4. Enables + starts the docker daemon.
#   5. Verifies the install with `docker run --rm hello-world` (best effort).
#
# Does NOT add any user to the docker group — see install-gtlnav-server.sh
# for the gtlnav system user that joins the docker group safely.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[gtlnav] install-docker.sh must run as root (use sudo)." >&2
  exit 1
fi

if ! command -v lsb_release >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y lsb-release
fi

DISTRO="$(. /etc/os-release && echo "$ID")"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs)}")"

if [[ "$DISTRO" != "ubuntu" && "$DISTRO" != "debian" ]]; then
  echo "[gtlnav] install-docker.sh targets Ubuntu/Debian; detected: $DISTRO" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  CURRENT="$(docker --version 2>/dev/null || true)"
  echo "[gtlnav] Docker already installed: ${CURRENT}"
  systemctl enable --now docker >/dev/null 2>&1 || true
  exit 0
fi

echo "[gtlnav] Removing legacy docker packages (if present)…"
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  apt-get remove -y "$pkg" >/dev/null 2>&1 || true
done

echo "[gtlnav] Installing prerequisites…"
apt-get update -y
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO} ${CODENAME} stable
EOF

echo "[gtlnav] Installing Docker Engine…"
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo "[gtlnav] Verifying install…"
if docker run --rm hello-world >/dev/null 2>&1; then
  echo "[gtlnav] Docker is up. Version: $(docker --version)"
else
  echo "[gtlnav] WARN — hello-world test failed. Check 'systemctl status docker'." >&2
fi
