// Tests for proxy cache operations
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  cacheResponse,
  createCacheKey,
  createKvCacheKey,
  createKvCacheResponse,
  deleteKvCache,
  deleteKvCacheByPrefix,
  formatKeyDate,
  getKvCachedContent,
  logEvent,
  type PrefixDeleteResult,
  parseKvCachedContent,
  sanitizeResponseHeaders,
  setKvCachedContent,
  storeInKvCache,
  tryGetKvCache,
} from './cache.ts';
import type {
  CachedContent,
  FetchAndCacheParams,
  LogEventDetail,
  ProxyCacheOptions,
  SetKvCacheParams,
} from './types.ts';

interface MockKv {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

interface MockListResult {
  keys: readonly { name: string }[];
  list_complete: boolean;
  cursor: string;
}

const createMockKv = (): MockKv => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
});

const createMockOptions = (overrides?: Partial<ProxyCacheOptions>): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map<string, number>(),
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- logEvent ---

test('logEvent does nothing when enableLogging is false', () => {
  const consoleSpy: ReturnType<typeof vi.fn> = vi.fn();
  vi.stubGlobal('console', { log: consoleSpy });
  const options: ProxyCacheOptions = createMockOptions({ enableLogging: false });
  const detail: LogEventDetail = { target: 'https://example.com' };
  logEvent(options, 'test-event', detail);
  expect(consoleSpy).not.toHaveBeenCalled();
});

test('logEvent logs when enableLogging is true', () => {
  const consoleSpy: ReturnType<typeof vi.fn> = vi.fn();
  vi.stubGlobal('console', { log: consoleSpy });
  const options: ProxyCacheOptions = createMockOptions({ enableLogging: true });
  const detail: LogEventDetail = { target: 'https://example.com' };
  logEvent(options, 'test-event', detail);
  expect(consoleSpy).toHaveBeenCalledWith('[reverse-proxy]', 'test-event', detail);
});

// --- formatKeyDate ---

test('formatKeyDate returns date part of ISO string', () => {
  const date: Date = new Date('2026-01-15T12:30:00Z');
  expect(formatKeyDate(date)).toBe('2026-01-15');
});

test('formatKeyDate returns date part for midnight', () => {
  const date: Date = new Date('2026-06-01T00:00:00Z');
  expect(formatKeyDate(date)).toBe('2026-06-01');
});

// --- createCacheKey ---

test('createCacheKey combines URL and date', () => {
  const target: URL = new URL('https://example.com/page');
  const date: Date = new Date('2026-03-10T08:00:00Z');
  expect(createCacheKey(target, date)).toBe('https://example.com/page::2026-03-10');
});

// --- createKvCacheKey ---

test('createKvCacheKey combines prefix, version, and url', () => {
  expect(createKvCacheKey('https://example.com', 'v2')).toBe('proxy-v2::https://example.com');
});

// --- parseKvCachedContent ---

test('parseKvCachedContent parses JSON string', () => {
  const json: string = JSON.stringify({ content: 'hello', contentType: 'text/html' });
  const result: CachedContent = parseKvCachedContent(json);
  expect(result).toStrictEqual({ content: 'hello', contentType: 'text/html' });
});

// --- getKvCachedContent ---

test('getKvCachedContent returns parsed content when cache hit', async () => {
  const mockKv: MockKv = createMockKv();
  const cached: CachedContent = { content: 'cached-body', contentType: 'text/plain' };
  mockKv.get.mockResolvedValue(JSON.stringify(cached));

  const result: CachedContent | null = await getKvCachedContent(
    mockKv as unknown as KVNamespace,
    'test-key',
  );

  expect(result).toStrictEqual({ content: 'cached-body', contentType: 'text/plain' });
  expect(mockKv.get).toHaveBeenCalledWith('test-key', 'text');
});

test('getKvCachedContent returns null when cache miss', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.get.mockResolvedValue(null);

  const result: CachedContent | null = await getKvCachedContent(
    mockKv as unknown as KVNamespace,
    'missing-key',
  );

  expect(result).toBeNull();
});

// --- setKvCachedContent ---

test('setKvCachedContent puts JSON data with TTL', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.put.mockResolvedValue(undefined);
  const data: CachedContent = { content: 'body', contentType: 'text/html' };

  const params: SetKvCacheParams = {
    kv: mockKv as unknown as KVNamespace,
    cacheKey: 'set-key',
    data,
  };

  await setKvCachedContent(params);

  expect(mockKv.put).toHaveBeenCalledWith(
    'set-key',
    JSON.stringify({ content: 'body', contentType: 'text/html' }),
    { expirationTtl: 432000 },
  );
});

// --- sanitizeResponseHeaders ---

test('sanitizeResponseHeaders removes set-cookie header', () => {
  const response: Response = new Response('body', {
    headers: {
      'content-type': 'text/html',
      'set-cookie': 'session=abc',
      'x-custom': 'value',
    },
  });

  const sanitized: Headers = sanitizeResponseHeaders(response);

  expect(sanitized.get('content-type')).toBe('text/html');
  expect(sanitized.get('x-custom')).toBe('value');
  expect(sanitized.get('set-cookie')).toBeNull();
});

test('sanitizeResponseHeaders returns headers when no set-cookie present', () => {
  const response: Response = new Response('body', {
    headers: { 'content-type': 'application/json' },
  });

  const sanitized: Headers = sanitizeResponseHeaders(response);

  expect(sanitized.get('content-type')).toBe('application/json');
});

// --- cacheResponse ---

test('cacheResponse clones response and puts into Cache API', async () => {
  const mockPut: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    default: { put: mockPut, match: vi.fn() },
  });

  const response: Response = new Response('response-body', {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'text/html',
      'set-cookie': 'session=xyz',
    },
  });

  await cacheResponse('https://cache-key', response);

  expect(mockPut).toHaveBeenCalledTimes(1);
  const putArgs: unknown[] = mockPut.mock.calls[0] ?? [];
  expect(putArgs[0]).toBe('https://cache-key');

  const cachedResponse: Response = putArgs[1] as Response;
  expect(cachedResponse.status).toBe(200);
  expect(cachedResponse.statusText).toBe('OK');
  expect(cachedResponse.headers.get('content-type')).toBe('text/html');
  expect(cachedResponse.headers.get('set-cookie')).toBeNull();
});

test('cacheResponse preserves non-200 status codes', async () => {
  const mockPut: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    default: { put: mockPut, match: vi.fn() },
  });

  const response: Response = new Response('not found', {
    status: 404,
    statusText: 'Not Found',
  });

  await cacheResponse('https://cache-404', response);

  const callArgs: unknown[] = mockPut.mock.calls[0] ?? [];
  const cachedResponse: Response = callArgs[1] as Response;
  expect(cachedResponse.status).toBe(404);
  expect(cachedResponse.statusText).toBe('Not Found');
});

// --- createKvCacheResponse ---

test('createKvCacheResponse creates response with content and content-type', () => {
  const cached: CachedContent = { content: 'html-body', contentType: 'text/html; charset=utf-8' };
  const response: Response = createKvCacheResponse(cached);

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
});

// --- storeInKvCache ---

test('storeInKvCache returns early when kv is undefined', async () => {
  const options: ProxyCacheOptions = createMockOptions({ kv: undefined });
  const params: FetchAndCacheParams = {
    cacheKey: 'ck',
    kvCacheKey: 'kvk',
    target: new URL('https://example.com'),
    options,
  };

  await storeInKvCache(params, new Response('body'));
  // No error thrown, no KV interaction
});

test('storeInKvCache stores response in KV when kv is defined', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.put.mockResolvedValue(undefined);
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKv as unknown as KVNamespace,
    enableLogging: false,
  });
  const params: FetchAndCacheParams = {
    cacheKey: 'ck',
    kvCacheKey: 'kv-store-key',
    target: new URL('https://example.com'),
    options,
  };

  const response: Response = new Response('stored-body', {
    headers: { 'content-type': 'text/plain' },
  });

  await storeInKvCache(params, response);

  expect(mockKv.put).toHaveBeenCalledTimes(1);
  const putArgs: unknown[] = mockKv.put.mock.calls[0] ?? [];
  expect(putArgs[0]).toBe('kv-store-key');
});

// --- tryGetKvCache ---

test('tryGetKvCache returns null when kv is undefined', async () => {
  const options: ProxyCacheOptions = createMockOptions({ kv: undefined });
  const result: Response | null = await tryGetKvCache(options, 'https://example.com', 'kvk');
  expect(result).toBeNull();
});

test('tryGetKvCache returns null on cache miss', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.get.mockResolvedValue(null);
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKv as unknown as KVNamespace,
  });

  const result: Response | null = await tryGetKvCache(options, 'https://example.com', 'kvk-miss');
  expect(result).toBeNull();
});

test('tryGetKvCache returns response on cache hit', async () => {
  const mockKv: MockKv = createMockKv();
  const cached: CachedContent = { content: 'hit-body', contentType: 'text/html' };
  mockKv.get.mockResolvedValue(JSON.stringify(cached));
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKv as unknown as KVNamespace,
  });

  const result: Response | null = await tryGetKvCache(options, 'https://example.com', 'kvk-hit');

  expect(result).not.toBeNull();
  expect(result?.status).toBe(200);
  const body: string = (await result?.text()) ?? '';
  expect(body).toBe('hit-body');
});

// --- deleteKvCache ---

test('deleteKvCache returns false when kv is undefined', async () => {
  const result: boolean = await deleteKvCache(undefined, 'key');
  expect(result).toBe(false);
});

test('deleteKvCache returns false when key does not exist', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.get.mockResolvedValue(null);

  const result: boolean = await deleteKvCache(mockKv as unknown as KVNamespace, 'missing-key');
  expect(result).toBe(false);
  expect(mockKv.delete).not.toHaveBeenCalled();
});

test('deleteKvCache deletes and returns true when key exists', async () => {
  const mockKv: MockKv = createMockKv();
  mockKv.get.mockResolvedValue('some-value');
  mockKv.delete.mockResolvedValue(undefined);

  const result: boolean = await deleteKvCache(mockKv as unknown as KVNamespace, 'existing-key');
  expect(result).toBe(true);
  expect(mockKv.delete).toHaveBeenCalledWith('existing-key');
});

// --- deleteKvCacheByPrefix ---

test('deleteKvCacheByPrefix returns zero result when kv is undefined', async () => {
  const result: PrefixDeleteResult = await deleteKvCacheByPrefix(undefined, 'prefix');
  expect(result).toStrictEqual({ deletedCount: 0, deletedKeys: [] });
});

test('deleteKvCacheByPrefix deletes all keys in single page', async () => {
  const mockKv: MockKv = createMockKv();
  const listResult: MockListResult = {
    keys: [{ name: 'prefix-key1' }, { name: 'prefix-key2' }, { name: 'prefix-key3' }],
    list_complete: true,
    cursor: '',
  };
  mockKv.list.mockResolvedValue(listResult);
  mockKv.delete.mockResolvedValue(undefined);

  const result: PrefixDeleteResult = await deleteKvCacheByPrefix(
    mockKv as unknown as KVNamespace,
    'prefix',
  );

  expect(result.deletedCount).toBe(3);
  expect(result.deletedKeys).toStrictEqual(['prefix-key1', 'prefix-key2', 'prefix-key3']);
  expect(mockKv.delete).toHaveBeenCalledWith('prefix-key1');
  expect(mockKv.delete).toHaveBeenCalledWith('prefix-key2');
  expect(mockKv.delete).toHaveBeenCalledWith('prefix-key3');
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'prefix', cursor: undefined });
});

test('deleteKvCacheByPrefix handles empty key list', async () => {
  const mockKv: MockKv = createMockKv();
  const listResult: MockListResult = {
    keys: [],
    list_complete: true,
    cursor: '',
  };
  mockKv.list.mockResolvedValue(listResult);

  const result: PrefixDeleteResult = await deleteKvCacheByPrefix(
    mockKv as unknown as KVNamespace,
    'no-match',
  );

  expect(result.deletedCount).toBe(0);
  expect(result.deletedKeys).toStrictEqual([]);
  expect(mockKv.delete).not.toHaveBeenCalled();
});

test('deleteKvCacheByPrefix handles multiple pages with cursor-based pagination', async () => {
  const mockKv: MockKv = createMockKv();
  const firstPage: MockListResult = {
    keys: [{ name: 'prefix-a' }, { name: 'prefix-b' }],
    list_complete: false,
    cursor: 'cursor-page2',
  };
  const secondPage: MockListResult = {
    keys: [{ name: 'prefix-c' }],
    list_complete: true,
    cursor: '',
  };
  mockKv.list.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
  mockKv.delete.mockResolvedValue(undefined);

  const result: PrefixDeleteResult = await deleteKvCacheByPrefix(
    mockKv as unknown as KVNamespace,
    'prefix',
  );

  expect(result.deletedCount).toBe(3);
  expect(result.deletedKeys).toStrictEqual(['prefix-a', 'prefix-b', 'prefix-c']);
  expect(mockKv.list).toHaveBeenCalledTimes(2);
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'prefix', cursor: undefined });
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'prefix', cursor: 'cursor-page2' });
  expect(mockKv.delete).toHaveBeenCalledTimes(3);
});

test('deleteKvCacheByPrefix handles three pages of results', async () => {
  const mockKv: MockKv = createMockKv();
  const page1: MockListResult = {
    keys: [{ name: 'p-1' }],
    list_complete: false,
    cursor: 'c2',
  };
  const page2: MockListResult = {
    keys: [{ name: 'p-2' }],
    list_complete: false,
    cursor: 'c3',
  };
  const page3: MockListResult = {
    keys: [{ name: 'p-3' }],
    list_complete: true,
    cursor: '',
  };
  mockKv.list
    .mockResolvedValueOnce(page1)
    .mockResolvedValueOnce(page2)
    .mockResolvedValueOnce(page3);
  mockKv.delete.mockResolvedValue(undefined);

  const result: PrefixDeleteResult = await deleteKvCacheByPrefix(
    mockKv as unknown as KVNamespace,
    'p',
  );

  expect(result.deletedCount).toBe(3);
  expect(result.deletedKeys).toStrictEqual(['p-1', 'p-2', 'p-3']);
  expect(mockKv.list).toHaveBeenCalledTimes(3);
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'p', cursor: undefined });
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'p', cursor: 'c2' });
  expect(mockKv.list).toHaveBeenCalledWith({ prefix: 'p', cursor: 'c3' });
});
