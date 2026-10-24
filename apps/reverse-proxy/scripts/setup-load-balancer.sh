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
# Health-check cost: every probe is a billed Worker request. With the old
# interval=60 from all regions each origin received ~1.06M probes/day.
# One region every 300s is a few hundred probes/day per origin. NEAS (Northeast
# Asia) is used because the callers and the netkeiba upstream are in Japan; the
# workers.dev origins run in every colo, so there is no single "origin region".
# Override with LB_CHECK_REGION / LB_MONITOR_INTERVAL in .dev.vars if needed.
CHECK_REGION="${LB_CHECK_REGION:-NEAS}"
MONITOR_INTERVAL="${LB_MONITOR_INTERVAL:-300}"
POOL_NAME="reverse-proxy-workers-pool"
LB_NAME="${API_DOMAIN}"

# Look up an existing object id by a field value (prints empty when absent).
find_id() {
  curl -sS "${AUTH[@]}" "$1" | jq -r --arg v "$3" ".result[] | select(.$2 == \$v) | .id" | head -1
}

# PATCH when the object exists (so reruns apply new settings), POST otherwise.
upsert() {
  local list_url="$1" field="$2" value="$3" payload="$4" id
  id=$(find_id "$list_url" "$field" "$value")
  if [ -n "$id" ]; then
    curl -sS "${AUTH[@]}" -X PATCH "${list_url}/${id}" --data "$payload" | jq -r '.result.id // empty'
  else
    curl -sS "${AUTH[@]}" -X POST "$list_url" --data "$payload" | jq -r '.result.id // empty'
  fi
}

echo "[1/4] Creating / updating HTTPS monitor (${MONITOR_NAME})..."
MONITOR_PAYLOAD=$(cat <<EOF
{
  "type": "https",
  "method": "GET",
  "path": "/healthcheck",
  "expected_codes": "2xx",
  "follow_redirects": false,
  "allow_insecure": false,
  "interval": ${MONITOR_INTERVAL},
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
MONITOR_ID=$(upsert "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/monitors" \
  description "$MONITOR_NAME" "$MONITOR_PAYLOAD")
if [ -z "$MONITOR_ID" ]; then
  echo "Error: failed to create or locate monitor"
  exit 1
fi
echo "  Monitor ID: $MONITOR_ID"

echo "[2/4] Creating / updating pool (${POOL_NAME}) with two worker origins..."
POOL_PAYLOAD=$(cat <<EOF
{
  "name": "${POOL_NAME}",
  "description": "Random between worker-a and worker-b (via workers.dev to avoid loopback)",
  "enabled": true,
  "monitor": "${MONITOR_ID}",
  "check_regions": ["${CHECK_REGION}"],
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
POOL_ID=$(upsert "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/load_balancers/pools" \
  name "$POOL_NAME" "$POOL_PAYLOAD")
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
echo "  Health checks     = every ${MONITOR_INTERVAL}s from ${CHECK_REGION}"
echo
echo "NOTE: Before the LB can own ${API_DOMAIN}, remove any existing Worker"
echo "route/custom domain binding for ${API_DOMAIN} (it used to point directly"
echo "to reverse-proxy-queue). The LB DNS record replaces it."
