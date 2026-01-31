// Fetch module tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BatchFetchResult, ProxyCacheOptions } from '../../types.ts';
import { fetchSingleUrl } from './fetch.ts';

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
  mockFetch.mockResolvedValueOnce(
    new Response('server error', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }),
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
