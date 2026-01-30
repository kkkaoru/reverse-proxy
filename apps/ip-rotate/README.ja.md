# IP Rotate - AWS CDK

複数のAWSリージョンにAPI Gateway HTTPプロキシエンドポイントをデプロイし、IPローテーションを実現します。

## 概要

このCDKアプリケーションは、ターゲットドメインへのHTTPプロキシとして機能するAPI Gatewayエンドポイントを作成します。複数のリージョンにデプロイすることで、各リクエストが異なるIPアドレスから発信され、リバースプロキシのIPローテーションが可能になります。

## アーキテクチャ

```
クライアントリクエスト
    │
    ▼
リバースプロキシ (Cloudflare Worker)
    │
    │ ラウンドロビン選択
    ▼
┌─────────────────────────────────────┐
│ API Gateway (HTTP_PROXY)            │
│ • us-east-1 (IP: x.x.x.x)          │
│ • eu-west-1 (IP: y.y.y.y)          │
│ • ap-northeast-1 (IP: z.z.z.z)     │
└─────────────────────────────────────┘
    │
    ▼
ターゲットサーバー (api.example.com)
```

## 前提条件

- [Bun](https://bun.sh/) ランタイム
- 適切な認証情報で設定されたAWS CLI
- AWS CDK CLI (`bun install` でインストールされます)

## インストール

```bash
bun install
```

## 設定

### 環境変数

`.env.example` を `.env` にコピーして設定してください：

```bash
cp .env.example .env
```

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| `CDK_DEFAULT_ACCOUNT` | はい | - | AWSアカウントID |
| `TARGET_DOMAINS` | はい | - | ターゲットドメイン（形式: `https:domain1,https:domain2`） |
| `REGIONS` | いいえ | `us-east-1,us-west-2,eu-west-1,ap-northeast-1` | デプロイするAWSリージョン |
| `STAGE_NAME` | いいえ | `proxy` | API Gatewayステージ名 |
| `AUTH_TYPE` | いいえ | `api-key` | 認証タイプ（`api-key` または `iam`） |

### CDK Context（代替方法）

CDKコンテキストでも設定を渡せます：

```bash
bunx cdk deploy --all \
  -c targetDomains=https:api.example.com \
  -c regions=us-east-1,eu-west-1 \
  -c stageName=proxy \
  -c authType=api-key
```

## 使用方法

### CloudFormationテンプレートの合成

```bash
bun run synth
```

### 全スタックのデプロイ

```bash
bun run deploy
```

### エンドポイントのエクスポート

デプロイ後、API GatewayエンドポイントをJSONにエクスポート：

```bash
bun run export
```

出力例：

```json
{
  "api.example.com": [
    "https://abc123.execute-api.us-east-1.amazonaws.com/proxy",
    "https://def456.execute-api.eu-west-1.amazonaws.com/proxy"
  ]
}
```

### 全スタックの削除

```bash
bun run destroy
```

## 認証

### API Key（デフォルト）

`AUTH_TYPE=api-key` の場合、各API Gatewayは以下で作成されます：
- レート制限付きUsage Plan（100リクエスト/秒、200バースト）
- 認証用API Key

#### デプロイ後のAPI Key取得

デプロイ後、AWS CLIでAPI Keyを取得します：

```bash
# 全てのAPI Keyを一覧表示
aws apigateway get-api-keys --include-values

# または特定のAPI GatewayのAPI Keyを取得
# まず、スタック出力からAPI IDを取得
aws cloudformation describe-stacks \
  --stack-name IpRotate-api-example-com-us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
  --output text

# そのAPIのAPI Keyを取得
aws apigateway get-api-keys --include-values \
  --query 'items[?contains(stageKeys[0].restApiId, `YOUR_API_ID`)].value' \
  --output text
```

#### リクエストでのAPI Key使用

リクエストにAPI Keyを含めてください：

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path
```

完全な例は [examples/curl-api-key.sh](examples/curl-api-key.sh) と [examples/typescript-api-key.ts](examples/typescript-api-key.ts) を参照してください。

### IAM認証

`AUTH_TYPE=iam` の場合、リクエストはAWS Signature V4で署名する必要があります。

#### IAM認証情報のセットアップ

1. IAMユーザーを作成するか、既存の認証情報を使用：

```bash
# IP Rotate用の新しいIAMユーザーを作成
aws iam create-user --user-name ip-rotate-user

# アクセスキーを作成
aws iam create-access-key --user-name ip-rotate-user
```

2. 必要なポリシー（execute-api:Invoke権限）をアタッチ：

```bash
# ポリシードキュメントを作成
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

# ポリシーを作成してアタッチ
aws iam create-policy \
  --policy-name IpRotateInvokePolicy \
  --policy-document file://ip-rotate-policy.json

aws iam attach-user-policy \
  --user-name ip-rotate-user \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/IpRotateInvokePolicy
```

#### IAM認証の使用

リクエストはAWS Signature V4で署名する必要があります。AWS SDKや `@smithy/signature-v4` などのライブラリを使用してください。

完全な例は [examples/curl-iam.sh](examples/curl-iam.sh) と [examples/typescript-iam.ts](examples/typescript-iam.ts) を参照してください。

## リバースプロキシとの統合

デプロイしたAPI Gatewayをリバースプロキシで使用するには、以下の環境変数を設定します：

### API Key認証の場合

```bash
# 認証タイプ
IP_ROTATE_AUTH_TYPE=api-key

# API Key（デプロイ後に取得）
IP_ROTATE_API_KEY=your-api-key-here

# エンドポイントJSON（`bun run export` の出力）
IP_ROTATE_ENDPOINTS='{"api.example.com":["https://abc123.execute-api.us-east-1.amazonaws.com/proxy","https://def456.execute-api.eu-west-1.amazonaws.com/proxy"]}'
```

### IAM認証の場合

```bash
# 認証タイプ
IP_ROTATE_AUTH_TYPE=iam

# AWS認証情報
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
AWS_REGION=us-east-1

# エンドポイントJSON（`bun run export` の出力）
IP_ROTATE_ENDPOINTS='{"api.example.com":["https://abc123.execute-api.us-east-1.amazonaws.com/proxy","https://def456.execute-api.eu-west-1.amazonaws.com/proxy"]}'
```

### クイックセットアップ（自動生成値）

デプロイ後、`IP_ROTATE_ENDPOINTS` と `IP_ROTATE_API_KEY` はAWSによって自動生成され、以下のコマンドで取得できます：

```bash
# 1. API Gatewayをデプロイ
bun run deploy

# 2. 自動生成された値を取得
export IP_ROTATE_AUTH_TYPE=api-key
export IP_ROTATE_API_KEY=$(aws apigateway get-api-keys --include-values --query 'items[0].value' --output text)
export IP_ROTATE_ENDPOINTS=$(bun run export | tr -d '\n')

# 値を確認
echo "API Key: $IP_ROTATE_API_KEY"
echo "Endpoints: $IP_ROTATE_ENDPOINTS"
```

## 開発

### テスト実行

```bash
bun run test
```

### カバレッジ付きテスト実行

```bash
bun run test:coverage
```

### 型チェック

```bash
bun run tsc
```

### リント

```bash
bun run biome
```

## スタック命名規則

スタックは `IpRotate-{ドメイン}-{リージョン}` のパターンで命名されます。

例: `IpRotate-api-example-com-us-east-1`

## コスト見積もり

- API Gateway: 100万リクエストあたり約$3.50
- アイドルコストなし（リクエスト課金のみ）

## ライセンス

ルートのLICENSEファイルを参照してください。
