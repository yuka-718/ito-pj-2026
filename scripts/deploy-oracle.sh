#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
ssh_target="${1:-}"
public_hostname="${2:-}"
if [[ -z "$ssh_target" || -z "$public_hostname" ]]; then
  echo "Usage: deploy-oracle.sh SSH_TARGET PUBLIC_HOSTNAME" >&2
  exit 1
fi
if [[ -z "${GROQ_API_KEY:-}" ]]; then
  read -r -s -p "Groq API key: " GROQ_API_KEY
  echo
fi
if [[ -z "$GROQ_API_KEY" ]]; then
  echo "Groq API key is required." >&2
  exit 1
fi

archive="$(mktemp /tmp/ori-ai-oracle-release.XXXXXX.tar.gz)"
env_file="$(mktemp /tmp/ori-ai-oracle-env.XXXXXX)"
trap 'rm -f "$archive" "$env_file"' EXIT
"$project_root/scripts/package-oracle-release.sh" "$archive" >/dev/null

umask 077
{
  printf 'GROQ_API_KEY=%q\n' "$GROQ_API_KEY"
  printf '%s\n' \
    'ORI_AI_LOCAL_HOST=127.0.0.1' \
    'ORI_AI_TRUST_PROXY=1' \
    'ORI_AI_MAX_CYCLES=10' \
    'ORI_AI_MAX_JOBS_PER_WINDOW=0' \
    'ORI_AI_RATE_WINDOW_MS=21600000' \
    'ORI_AI_JOB_TIMEOUT_MS=1200000' \
    'ORI_AI_GROQ_MODEL=qwen/qwen3.6-27b'
} > "$env_file"

scp "$archive" "$ssh_target:/tmp/ori-ai-release.tar.gz"
scp "$project_root/deploy/oracle/bootstrap.sh" "$ssh_target:/tmp/ori-ai-bootstrap.sh"
scp "$env_file" "$ssh_target:/tmp/ori-ai.env"
ssh "$ssh_target" \
  "sudo install -d -m 0700 /etc/ori-ai && sudo install -m 0600 /tmp/ori-ai.env /etc/ori-ai/ori-ai.env && sudo bash /tmp/ori-ai-bootstrap.sh /tmp/ori-ai-release.tar.gz '$public_hostname'"
