# バッチフェッチ API

SSRF保護付きで複数のURLを並列フェッチするバッチフェッチAPI。

## 概要

このモジュールはURLの配列を受け取り、以下の機能を持つPOSTエンドポイントを提供します：

- SSRF（サーバーサイドリクエストフォージェリ）保護
- 最大6並列リクエスト
- 失敗リクエストの自動リトライ（1回）
- リソース監視（メモリとサブリクエスト制限）
- レスポンスボディのUTF-8変換

## 使い方

### リクエスト

**エンドポイント:** `POST /`

**Content-Type:** `application/json`

**リクエストボディ:**

```json
{
  "urls": [
    "https://example.com",
    "https://httpbin.org/get"
  ]
}
```

### 例

```bash
curl -X POST https://your-worker.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com","https://httpbin.org/get"]}'
```

## レスポンス

### 成功レスポンス (200 OK)

リクエストと同じ順序で各URLの結果を配列で返します。

```json
[
  {
    "url": "https://example.com",
    "httpStatus": 200,
    "result": "success",
    "body": "<!doctype html>..."
  },
  {
    "url": "https://httpbin.org/get",
    "httpStatus": 200,
    "result": "success",
    "body": "{\"args\":{},...}"
  }
]
```

### レスポンスフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `url` | string | リクエストしたURL |
| `httpStatus` | number | ターゲットサーバーからのHTTPステータスコード（スキップ/ブロック時は0） |
| `result` | string | 結果ステータス（下記参照） |
| `body` | string | レスポンスボディ（UTF-8変換済み）またはエラーメッセージ |

### 結果ステータス値

| ステータス | 説明 |
|-----------|------|
| `success` | リクエスト成功（HTTPステータス1xx-3xx） |
| `error` | リクエスト失敗（HTTPステータス4xx-5xxまたはネットワークエラー） |
| `ssrf_blocked` | SSRF保護によりリクエストがブロックされた |
| `skipped` | リソース制限によりリクエストがスキップされた |

### エラーレスポンス

**400 Bad Request - 無効なJSON:**

```json
{
  "error": "Request body must be valid JSON"
}
```

**400 Bad Request - urls が存在しない:**

```json
{
  "error": "Request body must contain \"urls\" array"
}
```

## SSRF保護

以下がブロックされます：

### ブロックされるホスト名

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `[::1]`
- `[::]`

### ブロックされるIPレンジ

- `10.0.0.0/8`（プライベートネットワーク）
- `172.16.0.0/12`（プライベートネットワーク）
- `192.168.0.0/16`（プライベートネットワーク）
- `169.254.0.0/16`（リンクローカル）
- `fc00::/7`（IPv6ユニークローカル）
- `fe80::/10`（IPv6リンクローカル）

### 許可されるプロトコル

- `http:`
- `https:`

## モジュール構成

```
batch/
├── types.ts       # ローカル型定義
├── results.ts     # 結果作成と型ガード
├── queue.ts       # キュー管理
├── resources.ts   # リソース監視
├── fetch.ts       # 単一URLフェッチ
├── processing.ts  # バッチ処理ロジック
├── execution.ts   # 実行状態と制御
├── handler.ts     # リクエストハンドラー
├── README.md      # ドキュメント（英語）
└── README.ja.md   # このファイル（日本語）
```

## 制限

| 制限 | 値 | 説明 |
|-----|-----|------|
| 同時リクエスト数 | 6 | 最大並列フェッチ操作数 |
| メモリ | 100 MB | レスポンスボディのメモリ制限 |
| サブリクエスト数 | 1000 | Cloudflare Workersのサブリクエスト制限 |
