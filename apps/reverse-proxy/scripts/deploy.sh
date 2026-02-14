#!/bin/bash
# Deploy worker and restore wrangler.toml to template after deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

TEMPLATE="$APP_DIR/wrangler.toml.example"
OUTPUT="$APP_DIR/wrangler.toml"

# Function to restore template
restore_template() {
  if [ -f "$TEMPLATE" ]; then
    cp "$TEMPLATE" "$OUTPUT"
    echo "Restored wrangler.toml to template"
  fi
}

# Ensure template is restored on exit (success or failure)
trap restore_template EXIT

# Generate wrangler.toml from template
"$SCRIPT_DIR/setup-wrangler.sh"

# Deploy
cd "$APP_DIR"
bunx wrangler deploy "$@"

# Upload IP rotate endpoints to KV if file exists
ENDPOINTS_FILE="/tmp/ip-rotate-endpoints.json"
if [ -f "$ENDPOINTS_FILE" ]; then
  echo "Uploading IP rotate endpoints to KV..."
  "$SCRIPT_DIR/upload-endpoints-to-kv.sh"
fi

echo "Deploy completed successfully"
