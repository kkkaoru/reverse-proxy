#!/bin/bash
# Upload IP rotate endpoints JSON to KV storage
# Execute with bun: bun run upload-endpoints

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENDPOINTS_FILE="/tmp/ip-rotate-endpoints.json"
KV_KEY="ip-rotate-endpoints"

if [ ! -f "$ENDPOINTS_FILE" ]; then
  echo "Error: $ENDPOINTS_FILE not found"
  echo "Run the export-endpoints script in apps/ip-rotate first"
  exit 1
fi

cd "$APP_DIR"

# Generate wrangler.toml from template for KV namespace ID
"$SCRIPT_DIR/setup-wrangler.sh"

echo "Uploading endpoints to KV with key: $KV_KEY"
bunx wrangler kv key put --binding KV --remote "$KV_KEY" --path "$ENDPOINTS_FILE"

# Restore template
cp "$APP_DIR/wrangler.toml.example" "$APP_DIR/wrangler.toml"
echo "Upload completed successfully"
