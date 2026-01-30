#!/bin/bash
# Example: Request with x-api-key authentication using curl

# Configuration (can be overridden by environment variables)
API_ENDPOINT="${EXAMPLE_ENDPOINT:-https://abc123.execute-api.us-east-1.amazonaws.com/proxy}"
API_KEY="${IP_ROTATE_API_KEY:-your-api-key-here}"
TARGET_PATH="${EXAMPLE_PATH:-/ip}"

# GET request
curl -X GET \
  -H "x-api-key: ${API_KEY}" \
  "${API_ENDPOINT}${TARGET_PATH}"

# POST request with JSON body
curl -X POST \
  -H "x-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  "${API_ENDPOINT}${TARGET_PATH}"
