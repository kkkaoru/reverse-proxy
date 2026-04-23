#!/bin/bash
# Deploy one or both workers and restore wrangler.toml to template after deployment.
# Usage:
#   deploy.sh                  -> legacy single worker (wrangler.toml.example)
#   deploy.sh primary          -> deploy only reverse-proxy-queue-a
#   deploy.sh secondary        -> deploy only reverse-proxy-queue-b
#   deploy.sh both             -> deploy primary then secondary (required order: DO owner first)
# Any additional args are forwarded to `wrangler deploy`.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

TEMPLATE="$APP_DIR/wrangler.toml.example"
OUTPUT="$APP_DIR/wrangler.toml"

restore_template() {
  if [ -f "$TEMPLATE" ]; then
    cp "$TEMPLATE" "$OUTPUT"
    echo "Restored wrangler.toml to default template"
  fi
}

trap restore_template EXIT

VARIANT="${1:-default}"
shift || true

deploy_variant() {
  local variant="$1"
  shift
  echo "=== Deploying variant: $variant ==="
  "$SCRIPT_DIR/setup-wrangler.sh" "$variant"
  (cd "$APP_DIR" && bunx wrangler deploy "$@")
}

case "$VARIANT" in
  default)
    deploy_variant default "$@"
    ;;
  primary)
    deploy_variant primary "$@"
    ;;
  secondary)
    deploy_variant secondary "$@"
    ;;
  both)
    # Primary must be deployed first because it owns the DO class; the
    # secondary references it via script_name.
    deploy_variant primary "$@"
    deploy_variant secondary "$@"
    ;;
  *)
    echo "Error: unknown variant '$VARIANT' (expected default|primary|secondary|both)"
    exit 1
    ;;
esac

ENDPOINTS_FILE="/tmp/ip-rotate-endpoints.json"
if [ -f "$ENDPOINTS_FILE" ]; then
  echo "Uploading IP rotate endpoints to KV..."
  "$SCRIPT_DIR/upload-endpoints-to-kv.sh"
fi

echo "Deploy completed successfully"
