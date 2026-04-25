// Fetch module tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, expect, type MockInstance, test, vi } from 'vitest';
import type { BatchFetchResult, ProxyCacheOptions } from '../../types.ts';
import { fetchSingleUrl } from './fetch.ts';

interface MockKV {
  list: MockInstance;
  delete: MockInstance;
  get: MockInstance;
  put: MockInstance;
}

const createMockKV = (): MockKV => ({
  list: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
});

const createMockOptions = (overrides?: Partial<ProxyCacheOptions>): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
  ...overrides,
});

const mockFetch: ReturnType<typeof vi.fn> = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// fetchSingleUrl SSRF tests
test('fetchSingleUrl returns ssrf_blocked for localhost', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://localhost/admin',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for 127.0.0.1', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://127.0.0.1/secret',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for private IP 10.x.x.x', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://10.0.0.1/internal',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for private IP 192.168.x.x', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://192.168.1.1/router',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for private IP 172.16.x.x', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://172.16.0.1/internal',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for ftp protocol', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'ftp://example.com/file.txt',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

// fetchSingleUrl success tests
test('fetchSingleUrl returns success for valid URL with 200 response', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('success');
  expect(result.httpStatus).toStrictEqual(200);
  expect(result.url).toStrictEqual('https://example.com');
});

test('fetchSingleUrl returns success for 302 redirect', async () => {
  mockFetch.mockResolvedValueOnce(Response.redirect('https://example.com/new', 302));
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/old',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('success');
  expect(result.httpStatus).toStrictEqual(302);
});

// fetchSingleUrl error tests
test('fetchSingleUrl returns error for 500 response', async () => {
  // performFetch now retries transient 5xx up to PROXY_RETRY_MAX_ATTEMPTS
  // internally. Use mockImplementation to produce a fresh Response (fresh
  // body stream) per call so retries don't reuse an already-read body.
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response('server error', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    ),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(500);
});

test('fetchSingleUrl returns error for 404 response', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/missing',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(404);
});

test('fetchSingleUrl returns error when fetch throws', async () => {
  mockFetch.mockRejectedValueOnce(new Error('network error'));
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(502);
  expect(result.body).toStrictEqual('Fetch failed');
});

test('fetchSingleUrl returns body content for successful response', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('Hello World', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.body).toStrictEqual('Hello World');
});

// KV cache hit path
test('fetchSingleUrl returns cache_hit when KV has cached content', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.get.mockResolvedValue(
    JSON.stringify({ content: '<html>cached</html>', contentType: 'text/html' }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/cached-page',
    options: createMockOptions({ kv: mockKV as unknown as KVNamespace }),
  });
  expect(result.result).toStrictEqual('cache_hit');
  expect(result.httpStatus).toStrictEqual(200);
  expect(result.body).toStrictEqual('<html>cached</html>');
  expect(mockFetch).not.toHaveBeenCalled();
});

// KV cache store path on successful fetch (deferred via fire-and-forget)
test('fetchSingleUrl stores response in KV cache for cacheable status', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);
  mockFetch.mockResolvedValueOnce(
    new Response('<html>fresh</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/fresh',
    options: createMockOptions({ kv: mockKV as unknown as KVNamespace }),
  });
  expect(result.result).toStrictEqual('success');
  expect(result.httpStatus).toStrictEqual(200);
  // Wait for deferred KV write to complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(mockKV.put).toHaveBeenCalledTimes(1);
});

// KV cache store skipped for non-cacheable status
test('fetchSingleUrl does not store in KV cache for 500 status', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockFetch.mockResolvedValueOnce(
    new Response('error', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/error',
    options: createMockOptions({ kv: mockKV as unknown as KVNamespace }),
  });
  expect(result.result).toStrictEqual('error');
  expect(mockKV.put).not.toHaveBeenCalled();
});

// KV cache store with waitUntil
test('fetchSingleUrl uses waitUntil for KV cache store when executionCtx provided', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);
  const mockWaitUntil: ReturnType<typeof vi.fn> = vi.fn();
  mockFetch.mockResolvedValueOnce(
    new Response('<html>deferred</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com/deferred',
    options: createMockOptions({
      kv: mockKV as unknown as KVNamespace,
      executionCtx: {
        waitUntil: mockWaitUntil,
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    }),
  });
  expect(result.result).toStrictEqual('success');
  expect(mockWaitUntil).toHaveBeenCalledTimes(1);
});

// KV cache store without KV configured
test('fetchSingleUrl skips KV store when KV is not configured', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('<html>ok</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('success');
  expect(result.httpStatus).toStrictEqual(200);
});
