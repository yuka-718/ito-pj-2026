#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

release_archive="${1:-/tmp/ori-ai-release.tar.gz}"
public_hostname="${2:-}"
if [[ ! -f "$release_archive" || -z "$public_hostname" ]]; then
  echo "Usage: bootstrap.sh RELEASE_ARCHIVE PUBLIC_HOSTNAME" >&2
  exit 1
fi
if [[ ! -s /etc/ori-ai/ori-ai.env ]]; then
  echo "/etc/ori-ai/ori-ai.env is required." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils openjdk-21-jre xvfb caddy ufw

machine_arch="$(uname -m)"
case "$machine_arch" in
  aarch64|arm64) node_arch="arm64" ;;
  x86_64|amd64) node_arch="x64" ;;
  *) echo "Unsupported architecture: $machine_arch" >&2; exit 1 ;;
esac
node_version="v22.13.0"
node_archive="node-${node_version}-linux-${node_arch}.tar.xz"
node_base="https://nodejs.org/dist/${node_version}"
download_dir="$(mktemp -d)"
trap 'rm -rf "$download_dir"' EXIT
curl -fsSLo "$download_dir/$node_archive" "$node_base/$node_archive"
curl -fsSLo "$download_dir/SHASUMS256.txt" "$node_base/SHASUMS256.txt"
(
  cd "$download_dir"
  grep "  $node_archive$" SHASUMS256.txt | sha256sum -c -
)
rm -rf /opt/node.next
mkdir -p /opt/node.next
tar -xJf "$download_dir/$node_archive" -C /opt/node.next --strip-components=1
rm -rf /opt/node
mv /opt/node.next /opt/node

if ! id -u ori-ai >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/ori-ai --shell /usr/sbin/nologin ori-ai
fi
install -d -o ori-ai -g ori-ai -m 0750 /var/lib/ori-ai /var/lib/ori-ai/codex

deployment_dir="/opt/ori-ai.next"
rm -rf "$deployment_dir"
mkdir -p "$deployment_dir"
tar -xzf "$release_archive" -C "$deployment_dir"
test -f "$deployment_dir/app/local-oriedita/server.mjs"
test -f "$deployment_dir/oriedita.jar"
test -f "$deployment_dir/oriedita-mcp/server.mjs"

if [[ -d /opt/ori-ai ]]; then
  backup="/opt/ori-ai.previous-$(date +%Y%m%d%H%M%S)"
  mv /opt/ori-ai "$backup"
fi
mv "$deployment_dir" /opt/ori-ai
install -d -o ori-ai -g ori-ai -m 0750 /opt/ori-ai/app/work
chown -R ori-ai:ori-ai /opt/ori-ai

sudo -u ori-ai -H env PATH="/opt/node/bin:/usr/bin:/bin" \
  /opt/node/bin/npm --prefix /opt/ori-ai/oriedita-mcp ci --omit=dev

if [[ ! -x /var/lib/ori-ai/.local/bin/codex ]]; then
  sudo -u ori-ai -H bash -c 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
fi

set -a
# shellcheck disable=SC1091
source /etc/ori-ai/ori-ai.env
set +a
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is missing from /etc/ori-ai/ori-ai.env" >&2
  exit 1
fi
printf '%s' "$OPENAI_API_KEY" | sudo -u ori-ai -H env \
  HOME=/var/lib/ori-ai CODEX_HOME=/var/lib/ori-ai/codex \
  /var/lib/ori-ai/.local/bin/codex login --with-api-key

install -m 0644 /opt/ori-ai/app/deploy/oracle/ori-ai.service /etc/systemd/system/ori-ai.service
sed "s/__ORI_AI_HOSTNAME__/$public_hostname/g" \
  /opt/ori-ai/app/deploy/oracle/Caddyfile.template > /etc/caddy/Caddyfile

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable --now ori-ai.service
systemctl enable --now caddy.service
systemctl restart caddy.service

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8788/health >/dev/null; then
    echo "ORIAI is running at https://$public_hostname"
    exit 0
  fi
  sleep 2
done

journalctl -u ori-ai.service --no-pager -n 100 >&2
exit 1
