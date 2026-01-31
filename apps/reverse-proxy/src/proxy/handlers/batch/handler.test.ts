// Handler module tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BatchFetchResult, ProxyCacheOptions } from '../../types.ts';
import { handleBatchRequest } from './handler.ts';

interface ErrorBody {
  error: string;
}

const createMockOptions = (): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
});

const mockFetch: ReturnType<typeof vi.fn> = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// handleBatchRequest validation tests
test('handleBatchRequest returns error for null body', async () => {
  const response: Response = await handleBatchRequest(null, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must be valid JSON');
});

test('handleBatchRequest returns error for undefined body', async () => {
  const response: Response = await handleBatchRequest(undefined, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must be valid JSON');
});

test('handleBatchRequest returns error for string body', async () => {
  const response: Response = await handleBatchRequest('invalid', createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must be valid JSON');
});

test('handleBatchRequest returns error for number body', async () => {
  const response: Response = await handleBatchRequest(123, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must be valid JSON');
});

test('handleBatchRequest returns error for missing urls field', async () => {
  const response: Response = await handleBatchRequest({ other: 'field' }, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must contain "urls" array');
});

test('handleBatchRequest returns error for non-array urls', async () => {
  const response: Response = await handleBatchRequest(
    { urls: 'not-an-array' },
    createMockOptions(),
  );
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must contain "urls" array');
});

test('handleBatchRequest returns error for urls as object', async () => {
  const response: Response = await handleBatchRequest({ urls: {} }, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must contain "urls" array');
});

// handleBatchRequest success tests
test('handleBatchRequest returns results for valid request', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  const response: Response = await handleBatchRequest(
    { urls: ['https://example.com'] },
    createMockOptions(),
  );
  expect(response.status).toStrictEqual(200);
  const body: BatchFetchResult[] = await response.json();
  expect(body.length).toStrictEqual(1);
  const first: BatchFetchResult | undefined = body[0];
  expect(first?.result).toStrictEqual('success');
});

test('handleBatchRequest handles empty urls array', async () => {
  const response: Response = await handleBatchRequest({ urls: [] }, createMockOptions());
  expect(response.status).toStrictEqual(200);
  const body: BatchFetchResult[] = await response.json();
  expect(body.length).toStrictEqual(0);
});

test('handleBatchRequest handles mixed success and failure urls', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  const response: Response = await handleBatchRequest(
    { urls: ['https://example.com', 'https://localhost/admin'] },
    createMockOptions(),
  );
  expect(response.status).toStrictEqual(200);
  const body: BatchFetchResult[] = await response.json();
  expect(body.length).toStrictEqual(2);
  const first: BatchFetchResult | undefined = body[0];
  const second: BatchFetchResult | undefined = body[1];
  expect(first?.result).toStrictEqual('success');
  expect(second?.result).toStrictEqual('ssrf_blocked');
});

test('handleBatchRequest handles multiple valid URLs', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok1', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('ok2', { status: 200 }));
  const response: Response = await handleBatchRequest(
    { urls: ['https://a.com', 'https://b.com'] },
    createMockOptions(),
  );
  expect(response.status).toStrictEqual(200);
  const body: BatchFetchResult[] = await response.json();
  expect(body.length).toStrictEqual(2);
});

test('handleBatchRequest returns JSON content type', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  const response: Response = await handleBatchRequest(
    { urls: ['https://example.com'] },
    createMockOptions(),
  );
  expect(response.headers.get('content-type')).toStrictEqual('application/json; charset=utf-8');
});
