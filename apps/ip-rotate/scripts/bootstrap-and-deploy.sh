#!/bin/bash
# Bootstrap all regions and deploy all stacks in a single aws-vault session
# Usage: aws-vault exec personal -- bash scripts/bootstrap-and-deploy.sh
set -euo pipefail

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo "Account ID: $ACCOUNT_ID"

REGIONS_TO_BOOTSTRAP=(
  # US
  us-east-1 us-east-2 us-west-1 us-west-2
  # Africa
  af-south-1
  # Asia Pacific
  ap-east-2 ap-south-2
  ap-southeast-2 ap-southeast-3 ap-southeast-4
  ap-southeast-5 ap-southeast-6 ap-southeast-7
  # Canada
  ca-west-1
  # Europe
  eu-central-2 eu-south-1 eu-south-2 eu-north-1
  # Mexico
  mx-central-1
  # Middle East
  me-central-1 me-south-1
  # South America
  sa-east-1
  # Israel
  il-central-1
)

ALL_REGIONS=(
  # US
  us-east-1 us-east-2 us-west-1 us-west-2
  # Africa
  af-south-1
  # Asia Pacific
  ap-east-1 ap-east-2
  ap-south-1 ap-south-2
  ap-northeast-1 ap-northeast-2 ap-northeast-3
  ap-southeast-1 ap-southeast-2 ap-southeast-3 ap-southeast-4
  ap-southeast-5 ap-southeast-6 ap-southeast-7
  # Canada
  ca-central-1 ca-west-1
  # Europe
  eu-central-1 eu-central-2
  eu-south-1 eu-south-2
  eu-west-1 eu-west-2 eu-west-3
  eu-north-1
  # Mexico
  mx-central-1
  # Middle East
  me-central-1 me-south-1
  # South America
  sa-east-1
  # Israel
  il-central-1
)

echo ""
echo "=== Step 1: Cleanup failed CDKToolkit stacks ==="
for region in "${REGIONS_TO_BOOTSTRAP[@]}"; do
  # Check if stack exists and is in a failed state
  stack_exists=$(aws cloudformation describe-stacks --stack-name CDKToolkit --region "$region" 2>&1) || true
  if echo "$stack_exists" | grep -q "does not exist"; then
    echo "$region: clean"
    continue
  fi

  status=$(echo "$stack_exists" | python3 -c "import sys,json; print(json.load(sys.stdin)['Stacks'][0]['StackStatus'])" 2>/dev/null) || true

  if [ -z "$status" ]; then
    echo "$region: unable to get status, skipping"
    continue
  fi

  if echo "$status" | grep -q "COMPLETE"; then
    echo "$region: already bootstrapped ($status)"
    continue
  fi

  echo "$region: $status -> cleaning up..."

  # For DELETE_FAILED, use force delete
  if [ "$status" = "DELETE_FAILED" ]; then
    aws cloudformation delete-stack --stack-name CDKToolkit --region "$region" --deletion-mode FORCE_DELETE_STACK 2>/dev/null || true
  else
    # For ROLLBACK_FAILED etc, first try plain delete (transitions to DELETE_FAILED)
    aws cloudformation delete-stack --stack-name CDKToolkit --region "$region" 2>/dev/null || true
    echo "$region: waiting for delete attempt..."
    sleep 30
    # Now force delete if it's in DELETE_FAILED
    aws cloudformation delete-stack --stack-name CDKToolkit --region "$region" --deletion-mode FORCE_DELETE_STACK 2>/dev/null || true
  fi

  echo "$region: waiting for deletion..."
  for i in $(seq 1 12); do
    check=$(aws cloudformation describe-stacks --stack-name CDKToolkit --region "$region" 2>&1) || true
    if echo "$check" | grep -q "does not exist"; then
      echo "$region: deleted"
      break
    fi
    if [ "$i" -eq 12 ]; then
      echo "$region: WARNING - still not deleted after 60s"
    fi
    sleep 5
  done
done

echo ""
echo "=== Step 2: Bootstrap regions ==="
for region in "${REGIONS_TO_BOOTSTRAP[@]}"; do
  # Check if already bootstrapped
  param=$(aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version --region "$region" 2>&1) || true
  if echo "$param" | grep -q "Value"; then
    echo "$region: already bootstrapped"
    continue
  fi

  echo "$region: bootstrapping..."
  if npx cdk bootstrap "aws://${ACCOUNT_ID}/${region}" 2>&1; then
    echo "$region: OK"
  else
    echo "$region: FAILED"
  fi
done

echo ""
echo "=== Step 3: Verify all regions bootstrapped ==="
ready=0
not_ready=()
for region in "${ALL_REGIONS[@]}"; do
  param=$(aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version --region "$region" 2>&1) || true
  if echo "$param" | grep -q "Value"; then
    ready=$((ready+1))
  else
    not_ready+=("$region")
    echo "NOT READY: $region"
  fi
done
TOTAL_REGIONS=${#ALL_REGIONS[@]}
echo "Bootstrapped: $ready/$TOTAL_REGIONS"

if [ "$ready" -lt "$TOTAL_REGIONS" ]; then
  echo "ERROR: Not all regions bootstrapped. Missing: ${not_ready[*]}"
  echo "Aborting deploy."
  exit 1
fi

echo ""
echo "=== Step 4: Deploy all stacks ==="
npx cdk deploy --all --require-approval never --concurrency 10

echo ""
echo "=== Step 5: Export endpoints ==="
bun scripts/export-endpoints.ts

echo ""
echo "=== DONE ==="
