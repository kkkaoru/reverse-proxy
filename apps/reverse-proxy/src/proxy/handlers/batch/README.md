# Batch Fetch API

Batch Fetch API for fetching multiple URLs in parallel with SSRF protection.

## Overview

This module provides a POST endpoint that accepts an array of URLs and fetches them concurrently with:

- SSRF (Server-Side Request Forgery) protection
- Maximum 6 concurrent requests
- Automatic retry for failed requests (once)
- Resource monitoring (memory and subrequest limits)
- UTF-8 response body conversion

## Usage

### Request

**Endpoint:** `POST /`

**Content-Type:** `application/json`

**Request Body:**

```json
{
  "urls": [
    "https://example.com",
    "https://httpbin.org/get"
  ]
}
```

### Example

```bash
curl -X POST https://your-worker.workers.dev/ \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com","https://httpbin.org/get"]}'
```

## Response

### Success Response (200 OK)

Returns an array of results for each URL in the same order as the request.

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

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The requested URL |
| `httpStatus` | number | HTTP status code from the target server (0 for skipped/blocked) |
| `result` | string | Result status (see below) |
| `body` | string | Response body (UTF-8 converted) or error message |

### Result Status Values

| Status | Description |
|--------|-------------|
| `success` | Request completed successfully (1xx-3xx HTTP status) |
| `error` | Request failed (4xx-5xx HTTP status or network error) |
| `ssrf_blocked` | Request blocked due to SSRF protection |
| `skipped` | Request skipped due to resource limits |

### Error Responses

**400 Bad Request - Invalid JSON:**

```json
{
  "error": "Request body must be valid JSON"
}
```

**400 Bad Request - Missing urls:**

```json
{
  "error": "Request body must contain \"urls\" array"
}
```

## SSRF Protection

The following are blocked:

### Blocked Hostnames

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `[::1]`
- `[::]`

### Blocked IP Ranges

- `10.0.0.0/8` (Private network)
- `172.16.0.0/12` (Private network)
- `192.168.0.0/16` (Private network)
- `169.254.0.0/16` (Link-local)
- `fc00::/7` (IPv6 unique local)
- `fe80::/10` (IPv6 link-local)

### Allowed Protocols

- `http:`
- `https:`

## Module Structure

```
batch/
├── types.ts       # Local type definitions
├── results.ts     # Result creation and type guards
├── queue.ts       # Queue management
├── resources.ts   # Resource monitoring
├── fetch.ts       # Single URL fetch
├── processing.ts  # Batch processing logic
├── execution.ts   # Execution state and control
├── handler.ts     # Request handler
├── README.md      # This file (English)
└── README.ja.md   # Documentation (Japanese)
```

## Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Concurrent Requests | 6 | Maximum parallel fetch operations |
| Memory | 100 MB | Response body memory limit |
| Subrequests | 1000 | Cloudflare Workers subrequest limit |
