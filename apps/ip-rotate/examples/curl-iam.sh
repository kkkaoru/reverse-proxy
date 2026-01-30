#!/bin/bash
# Example: Request with IAM authentication using curl
# Requires: awscurl (pip install awscurl)

# Configuration (can be overridden by environment variables)
API_ENDPOINT="${EXAMPLE_ENDPOINT:-https://abc123.execute-api.us-east-1.amazonaws.com/proxy}"
IAM_REGION="${AWS_REGION:-us-east-1}"
TARGET_PATH="${EXAMPLE_PATH:-/ip}"

# ===========================================
# Option 1: Using awscurl (recommended)
# Install: pip install awscurl
# ===========================================

# GET request
awscurl --service execute-api \
  --region "${IAM_REGION}" \
  "${API_ENDPOINT}${TARGET_PATH}"

# POST request with JSON body
awscurl --service execute-api \
  --region "${IAM_REGION}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  "${API_ENDPOINT}${TARGET_PATH}"

# With explicit credentials
awscurl --service execute-api \
  --region "${IAM_REGION}" \
  --access_key "${AWS_ACCESS_KEY_ID}" \
  --secret_key "${AWS_SECRET_ACCESS_KEY}" \
  "${API_ENDPOINT}${TARGET_PATH}"
