#!/bin/bash
# Create / update Cloudflare Load Balancer fronting the shared API_DOMAIN
# and distributing traffic across the two worker custom domains.
#
# Required env vars (loaded from .dev.vars):
#   CLOUDFLARE_ACCOUNT_ID
#   CLOUDFLARE_ZONE_ID
#   CLOUDFLARE_API_TOKEN_LB   (Load Balancing: Edit + Zone: DNS: Edit)
#   API_DOMAIN                (the original shared hostname, e.g. reverse-proxy.api.kkk4oru.com)
#   PRIMARY_WORKER_DOMAIN     (e.g. reverse-proxy-a.api.kkk4oru.com)
#   SECONDARY_WORKER_DOMAIN   (e.g. reverse-proxy-b.api.kkk4oru.com)
#
# Usage: bun run lb:setup

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
DEV_VARS="$APP_DIR/.dev.vars"

if [ ! -f "$DEV_VARS" ]; then
  echo "Error: $DEV_VARS not found."
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$DEV_VARS"
set +a

for v in CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN_LB API_DOMAIN PRIMARY_WORKER_DOMAIN SECONDARY_WORKER_DOMAIN; do
  if [ -z "${!v}" ]; then
    echo "Error: $v is not set in $DEV_VARS"
    exit 1
  fi
done

# Pool origins must point to workers.dev URLs (not the custom domains).
# Cloudflare LB returns error 1000 "DNS points to prohibited IP" when the
# origin resolves to the same Cloudflare edge IPs that serve the LB DNS
# record. *.workers.dev is on a different internal edge pool, so it bypasses
# the loopback protection and the LB can route correctly.
PRIMARY_ORIGIN="${PRIMARY_WORKERS_DEV:-reverse-proxy-queue-a.kaoru.workers.dev}"
SECONDARY_ORIGIN="${SECONDARY_WORKERS_DEV:-reverse-proxy-queue-b.kaoru.workers.dev}"

CF_API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN_LB}" -H "Content-Type: application/json")

MONITOR_NAME="reverse-proxy-monitor"
POOL_NAME="reverse-proxy-workers-pool"
LB_NAME="${API_DOMAIN}"

echo "[1/4] Creating HTTPS monitor (${MONITOR_NAME})..."
MONITOR_PAYLOAD=$(cat <<EOF
{
  "type": "https",
  "method": "GET",
  "path": "/healthcheck",
  "expected_codes": "2xx",
  "follow_redirects": false,
  "allow_insecure": false,
  "interval": 60,
  "timeout": 10,
  "retries": 2,
  "description": "${MONITOR_NAME}",
  "header": {
    "Host": ["${PRIMARY_ORIGIN}"],
    "User-Agent": ["cf-lb-monitor"]
  }
}
EOF
)
MONITOR_ID=$(curl -sS "${AUTH[@]}" \
  -X POST "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/monitors" \
  --data "$MONITOR_PAYLOAD" | jq -r '.result.id // empty')
if [ -z "$MONITOR_ID" ]; then
  echo "Monitor may already exist; listing and reusing by description..."
  MONITOR_ID=$(curl -sS "${AUTH[@]}" \
    "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/monitors" \
    | jq -r --arg d "$MONITOR_NAME" '.result[] | select(.description == $d) | .id' | head -1)
fi
if [ -z "$MONITOR_ID" ]; then
  echo "Error: failed to create or locate monitor"
  exit 1
fi
echo "  Monitor ID: $MONITOR_ID"

echo "[2/4] Creating pool (${POOL_NAME}) with two worker origins..."
POOL_PAYLOAD=$(cat <<EOF
{
  "name": "${POOL_NAME}",
  "description": "Random between worker-a and worker-b (via workers.dev to avoid loopback)",
  "enabled": true,
  "monitor": "${MONITOR_ID}",
  "origins": [
    {
      "name": "primary",
      "address": "${PRIMARY_ORIGIN}",
      "enabled": true,
      "weight": 1,
      "header": { "Host": ["${PRIMARY_ORIGIN}"] }
    },
    {
      "name": "secondary",
      "address": "${SECONDARY_ORIGIN}",
      "enabled": true,
      "weight": 1,
      "header": { "Host": ["${SECONDARY_ORIGIN}"] }
    }
  ],
  "origin_steering": { "policy": "random" },
  "minimum_origins": 1
}
EOF
)
POOL_ID=$(curl -sS "${AUTH[@]}" \
  -X POST "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/pools" \
  --data "$POOL_PAYLOAD" | jq -r '.result.id // empty')
if [ -z "$POOL_ID" ]; then
  echo "Pool may already exist; listing and reusing by name..."
  POOL_ID=$(curl -sS "${AUTH[@]}" \
    "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/pools" \
    | jq -r --arg n "$POOL_NAME" '.result[] | select(.name == $n) | .id' | head -1)
fi
if [ -z "$POOL_ID" ]; then
  echo "Error: failed to create or locate pool"
  exit 1
fi
echo "  Pool ID: $POOL_ID"

echo "[3/4] Creating load balancer on ${LB_NAME}..."
LB_PAYLOAD=$(cat <<EOF
{
  "name": "${LB_NAME}",
  "description": "Fronts ${API_DOMAIN} across two worker subdomains",
  "proxied": true,
  "enabled": true,
  "steering_policy": "random",
  "default_pools": ["${POOL_ID}"],
  "fallback_pool": "${POOL_ID}",
  "session_affinity": "none"
}
EOF
)
LB_ID=$(curl -sS "${AUTH[@]}" \
  -X POST "${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/load_balancers" \
  --data "$LB_PAYLOAD" | jq -r '.result.id // empty')
if [ -z "$LB_ID" ]; then
  echo "Load balancer may already exist; listing and reusing by name..."
  LB_ID=$(curl -sS "${AUTH[@]}" \
    "${CF_API}/zones/${CLOUDFLARE_ZONE_ID}/load_balancers" \
    | jq -r --arg n "$LB_NAME" '.result[] | select(.name == $n) | .id' | head -1)
fi
if [ -z "$LB_ID" ]; then
  echo "Error: failed to create or locate load balancer"
  exit 1
fi
echo "  LB ID: $LB_ID"

echo "[4/4] Done."
echo "  API_DOMAIN        = ${API_DOMAIN}  (served by Cloudflare LB id=${LB_ID})"
echo "  Primary origin    = ${PRIMARY_WORKER_DOMAIN}"
echo "  Secondary origin  = ${SECONDARY_WORKER_DOMAIN}"
echo
echo "NOTE: Before the LB can own ${API_DOMAIN}, remove any existing Worker"
echo "route/custom domain binding for ${API_DOMAIN} (it used to point directly"
echo "to reverse-proxy-queue). The LB DNS record replaces it."
