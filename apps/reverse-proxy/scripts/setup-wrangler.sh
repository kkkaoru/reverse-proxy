#!/bin/bash
# Generate wrangler.toml from template and .dev.vars

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

DEV_VARS="$APP_DIR/.dev.vars"
TEMPLATE="$APP_DIR/wrangler.toml.example"
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

echo "Generated $OUTPUT"
