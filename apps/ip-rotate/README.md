# IP Rotate - AWS CDK

Deploy API Gateway HTTP Proxy endpoints across multiple AWS regions for IP rotation.

## Overview

This CDK application creates API Gateway endpoints that act as HTTP proxies to your target domains. By deploying to multiple regions, each request can originate from a different IP address, enabling IP rotation for your reverse proxy.

## Architecture

```
Client Request
    │
    ▼
Reverse Proxy (Cloudflare Worker)
    │
    │ Round-robin selection
    ▼
┌─────────────────────────────────────┐
│ API Gateway (HTTP_PROXY)            │
│ • us-east-1 (IP: x.x.x.x)          │
│ • eu-west-1 (IP: y.y.y.y)          │
│ • ap-northeast-1 (IP: z.z.z.z)     │
└─────────────────────────────────────┘
    │
    ▼
Target Server (api.example.com)
```

## Prerequisites

- [Bun](https://bun.sh/) runtime
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`bun install` will install it)

## Installation

```bash
bun install
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CDK_DEFAULT_ACCOUNT` | Yes | - | AWS Account ID |
| `TARGET_DOMAINS` | Yes | - | Target domains (format: `https:domain1,https:domain2`) |
| `REGIONS` | No | `us-east-1,us-west-2,eu-west-1,ap-northeast-1` | AWS regions to deploy |
| `STAGE_NAME` | No | `proxy` | API Gateway stage name |
| `AUTH_TYPE` | No | `api-key` | Authentication type (`api-key` or `iam`) |

### CDK Context (Alternative)

You can also pass configuration via CDK context:

```bash
bunx cdk deploy --all \
  -c targetDomains=https:api.example.com \
  -c regions=us-east-1,eu-west-1 \
  -c stageName=proxy \
  -c authType=api-key
```

## Usage

### Synthesize CloudFormation Templates

```bash
bun run synth
```

### Deploy All Stacks

```bash
bun run deploy
```

### Export Endpoints

After deployment, export the API Gateway endpoints to JSON:

```bash
bun run export
```

Output example:

```json
{
  "api.example.com": [
    "https://abc123.execute-api.us-east-1.amazonaws.com/proxy",
    "https://def456.execute-api.eu-west-1.amazonaws.com/proxy"
  ]
}
```

### Destroy All Stacks

```bash
bun run destroy
```

## Authentication

### API Key (Default)

When `AUTH_TYPE=api-key`, each API Gateway is created with:
- Usage Plan with rate limiting (100 req/s, 200 burst)
- API Key for authentication

#### Retrieving API Keys After Deployment

After deploying, retrieve the API keys using AWS CLI:

```bash
# List all API keys
aws apigateway get-api-keys --include-values

# Or get API key for a specific API Gateway
# First, get the API ID from the stack outputs
aws cloudformation describe-stacks \
  --stack-name IpRotate-api-example-com-us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
  --output text

# Then list API keys for that API
aws apigateway get-api-keys --include-values \
  --query 'items[?contains(stageKeys[0].restApiId, `YOUR_API_ID`)].value' \
  --output text
```

#### Using API Key in Requests

Include the API key in requests:

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path
```

See [examples/curl-api-key.sh](examples/curl-api-key.sh) and [examples/typescript-api-key.ts](examples/typescript-api-key.ts) for complete examples.

### IAM Authentication

When `AUTH_TYPE=iam`, requests must be signed with AWS Signature V4.

#### Setting Up IAM Credentials

1. Create an IAM user or use existing credentials:

```bash
# Create a new IAM user for IP Rotate
aws iam create-user --user-name ip-rotate-user

# Create access keys
aws iam create-access-key --user-name ip-rotate-user
```

2. Attach the required policy (execute-api:Invoke permission):

```bash
# Create policy document
cat > ip-rotate-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:*:YOUR_ACCOUNT_ID:*"
    }
  ]
}
EOF

# Create and attach the policy
aws iam create-policy \
  --policy-name IpRotateInvokePolicy \
  --policy-document file://ip-rotate-policy.json

aws iam attach-user-policy \
  --user-name ip-rotate-user \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/IpRotateInvokePolicy
```

#### Using IAM Authentication

Requests must be signed with AWS Signature V4. Use AWS SDK or libraries like `@smithy/signature-v4`.

See [examples/curl-iam.sh](examples/curl-iam.sh) and [examples/typescript-iam.ts](examples/typescript-iam.ts) for complete examples.

## Reverse Proxy Integration

To use the deployed API Gateways with the reverse-proxy, set the following environment variables:

### API Key Authentication

```bash
# Authentication type
IP_ROTATE_AUTH_TYPE=api-key

# API Key (retrieved after deployment)
IP_ROTATE_API_KEY=your-api-key-here

# Endpoints JSON (output from `bun run export`)
IP_ROTATE_ENDPOINTS='{"api.example.com":["https://abc123.execute-api.us-east-1.amazonaws.com/proxy","https://def456.execute-api.eu-west-1.amazonaws.com/proxy"]}'
```

### IAM Authentication

```bash
# Authentication type
IP_ROTATE_AUTH_TYPE=iam

# AWS credentials
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=us-east-1

# Endpoints JSON (output from `bun run export`)
IP_ROTATE_ENDPOINTS='{"api.example.com":["https://abc123.execute-api.us-east-1.amazonaws.com/proxy","https://def456.execute-api.eu-west-1.amazonaws.com/proxy"]}'
```

### Quick Setup (Auto-Generated Values)

After deployment, `IP_ROTATE_ENDPOINTS` and `IP_ROTATE_API_KEY` are automatically generated by AWS and can be retrieved with the following commands:

```bash
# 1. Deploy API Gateways
bun run deploy

# 2. Get auto-generated values
export IP_ROTATE_AUTH_TYPE=api-key
export IP_ROTATE_API_KEY=$(aws apigateway get-api-keys --include-values --query 'items[0].value' --output text)
export IP_ROTATE_ENDPOINTS=$(bun run export | tr -d '\n')

# Verify values
echo "API Key: $IP_ROTATE_API_KEY"
echo "Endpoints: $IP_ROTATE_ENDPOINTS"
```

## Development

### Run Tests

```bash
bun run test
```

### Run Tests with Coverage

```bash
bun run test:coverage
```

### Type Check

```bash
bun run tsc
```

### Lint

```bash
bun run biome
```

## Stack Naming Convention

Stacks are named using the pattern: `IpRotate-{domain}-{region}`

Example: `IpRotate-api-example-com-us-east-1`

## Cost Estimate

- API Gateway: ~$3.50 per 1 million requests
- No idle cost (pay per request only)

## License

See the root LICENSE file.
