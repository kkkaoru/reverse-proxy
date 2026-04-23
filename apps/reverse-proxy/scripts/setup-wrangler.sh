#!/bin/bash
# shellcheck disable=all
# Generate wrangler.toml from a template and .dev.vars.
# Usage: setup-wrangler.sh [primary|secondary|default]
#   default (no arg) -> wrangler.toml.example
#   primary          -> wrangler.primary.toml.example
#   secondary        -> wrangler.secondary.toml.example

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

DEV_VARS="$APP_DIR/.dev.vars"
VARIANT="${1:-default}"

case "$VARIANT" in
  primary)
    TEMPLATE="$APP_DIR/wrangler.primary.toml.example"
    ;;
  secondary)
    TEMPLATE="$APP_DIR/wrangler.secondary.toml.example"
    ;;
  default)
    TEMPLATE="$APP_DIR/wrangler.toml.example"
    ;;
  *)
    echo "Error: unknown variant '$VARIANT' (expected primary|secondary|default)"
    exit 1
    ;;
esac

OUTPUT="$APP_DIR/wrangler.toml"

if [ ! -f "$DEV_VARS" ]; then
  echo "Error: $DEV_VARS not found. Copy .dev.vars.example to .dev.vars first."
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "Error: $TEMPLATE not found."
  exit 1
fi

# Load environment variables from .dev.vars
set -a
source "$DEV_VARS"
set +a

# Generate wrangler.toml by substituting environment variables
envsubst < "$TEMPLATE" > "$OUTPUT"

echo "Generated $OUTPUT (from $VARIANT variant)"
