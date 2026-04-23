#!/bin/bash
# Purge KV entries whose cached body matches an Akamai "Access Denied" block page.
# Execute with bun: bun run ./scripts/purge-akamai-cache.sh
#
# Requires: wrangler authenticated, KV binding name "KV", jq
#
# Strategy:
#   1. List all KV keys
#   2. For each key, fetch value
#   3. If value contains Akamai block markers, delete the key
#
# Run with --dry-run to list matching keys without deleting.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  echo "[dry-run] No deletions will be performed"
fi

cd "$APP_DIR"

# Ensure wrangler.toml is generated (KV namespace ID required)
"$SCRIPT_DIR/setup-wrangler.sh"

AKAMAI_MARKERS=(
  "<TITLE>Access Denied</TITLE>"
  "<title>access denied</title>"
  "<h1>Access Denied</h1>"
  "errors.edgesuite.net"
)

echo "Listing KV keys..."
KEYS_JSON=$(bunx wrangler kv key list --binding KV --remote)
KEY_COUNT=$(printf '%s' "$KEYS_JSON" | jq 'length')
echo "Total KV keys: $KEY_COUNT"

MATCHED=0
DELETED=0
FAILED=0

while IFS= read -r KEY; do
  VALUE=$(bunx wrangler kv key get --binding KV --remote "$KEY" 2>/dev/null || true)
  HIT=0
  for MARKER in "${AKAMAI_MARKERS[@]}"; do
    if printf '%s' "$VALUE" | grep -qF "$MARKER"; then
      HIT=1
      break
    fi
  done
  if [ "$HIT" -eq 1 ]; then
    MATCHED=$((MATCHED + 1))
    echo "[akamai-block] $KEY"
    if [ "$DRY_RUN" -eq 0 ]; then
      if bunx wrangler kv key delete --binding KV --remote "$KEY" >/dev/null 2>&1; then
        DELETED=$((DELETED + 1))
      else
        FAILED=$((FAILED + 1))
        echo "  (delete failed)"
      fi
    fi
  fi
done < <(printf '%s' "$KEYS_JSON" | jq -r '.[].name')

echo "---"
echo "Matched: $MATCHED"
if [ "$DRY_RUN" -eq 0 ]; then
  echo "Deleted: $DELETED"
  echo "Failed:  $FAILED"
fi

# Restore wrangler.toml template
cp "$APP_DIR/wrangler.toml.example" "$APP_DIR/wrangler.toml"
echo "Template restored"
