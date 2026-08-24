#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
oriedita_root="${ORIEDITA_SOURCE_ROOT:-/Users/yukaito/Documents/oriedita}"
output_path="${1:-$project_root/outputs/ori-ai-oracle-release.tar.gz}"
jar_path="$oriedita_root/oriedita/target/oriedita-1.1.4-SNAPSHOT.jar"
mcp_root="$oriedita_root/oriedita-mcp"

test -f "$jar_path"
test -f "$mcp_root/server.mjs"
test -f "$mcp_root/package.json"
test -f "$mcp_root/package-lock.json"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app" "$stage/oriedita-mcp" "$(dirname "$output_path")"

git -C "$project_root" archive HEAD | tar -x -C "$stage/app"
cp "$jar_path" "$stage/oriedita.jar"
cp "$mcp_root/server.mjs" "$mcp_root/package.json" "$mcp_root/package-lock.json" "$stage/oriedita-mcp/"
cp "$oriedita_root/LICENSE.md" "$stage/ORIEDITA-LICENSE.md"

tar -czf "$output_path" -C "$stage" .
echo "$output_path"
