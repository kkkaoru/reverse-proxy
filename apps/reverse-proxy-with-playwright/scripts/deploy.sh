#!/bin/bash
# Deployment script for reverse-proxy-with-playwright
# This script reads IDs from .dev.vars and deploys to Cloudflare Workers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if .dev.vars exists
if [ ! -f ".dev.vars" ]; then
  echo "Error: .dev.vars file not found"
  echo "Create .dev.vars with the following variables:"
  echo "  D1_DATABASE_ID=<your-d1-database-id>"
  echo "  KV_NAMESPACE_ID=<your-kv-namespace-id>"
  exit 1
fi

# Load environment variables from .dev.vars
set -a
source .dev.vars
set +a

# Validate required variables
if [ -z "$D1_DATABASE_ID" ]; then
  echo "Error: D1_DATABASE_ID is not set in .dev.vars"
  exit 1
fi

if [ -z "$KV_NAMESPACE_ID" ]; then
  echo "Error: KV_NAMESPACE_ID is not set in .dev.vars"
  exit 1
fi

echo "Deploying reverse-proxy-with-playwright..."
echo "  D1 Database ID: ${D1_DATABASE_ID:0:8}..."
echo "  KV Namespace ID: ${KV_NAMESPACE_ID:0:8}..."

# Backup original wrangler.toml
cp wrangler.toml wrangler.toml.bak

# Create temporary wrangler.toml with actual IDs
cat > wrangler.toml << EOF
# Cloudflare Worker configuration for reverse-proxy-with-playwright
# NOTE: Actual database_id and kv namespace id values are stored in .dev.vars (not committed to git)
# Create .dev.vars with: D1_DATABASE_ID=<your-id> and KV_NAMESPACE_ID=<your-id>

name = "reverse-proxy-with-playwright"
main = "src/index.ts"
compatibility_date = "2025-10-09"
compatibility_flags = ["nodejs_compat"]

[browser]
binding = "BROWSER"

[[d1_databases]]
binding = "DB"
database_name = "reverse-proxy-playwright-db"
database_id = "${D1_DATABASE_ID}"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "KV"
id = "${KV_NAMESPACE_ID}"

[observability.logs]
enabled = true
EOF

# Deploy
DEPLOY_EXIT_CODE=0
bunx wrangler deploy "$@" || DEPLOY_EXIT_CODE=$?

# Restore original wrangler.toml
mv wrangler.toml.bak wrangler.toml

if [ $DEPLOY_EXIT_CODE -eq 0 ]; then
  echo ""
  echo "Deployment successful!"
else
  echo ""
  echo "Deployment failed with exit code: $DEPLOY_EXIT_CODE"
  exit $DEPLOY_EXIT_CODE
fi
