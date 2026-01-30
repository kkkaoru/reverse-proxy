// Test file for playwright.core.ts
// Tests the core logic without browser dependency
// Execute with bun: bun run test

import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type {
  CachedContent,
  FetchPageResponse,
  PlaywrightCoreEnv,
} from '../src/playwright/core.ts';
import {
  CACHE_HIT,
  CACHE_MISS,
  CACHE_TTL_SECONDS,
  CONTENT_TYPE_HTML,
  CONTENT_TYPE_JSON,
  createCacheKey,
  createContentResponse,
  createErrorResponse,
  createJsonResponse,
  delay,
  deleteKvCache,
  ERROR_INVALID_URL,
  ERROR_MISSING_URL,
  getCachedContent,
  getErrorMessage,
  handleCoreRequest,
  handleDeleteRequest,
  handleFetchError,
  handleFetchSuccess,
  isCacheableStatus,
  isFetchSuccess,
  isHtmlContentType,
  isLoggingEnabled,
  isValidUrl,
  LOG_PREFIX,
  logEvent,
  PLAYWRIGHT_PATH,
  parseCachedContent,
  parseIpRotateConfigFromEnv,
  parseRequest,
  STATUS_BAD_GATEWAY,
  STATUS_BAD_REQUEST,
  STATUS_NOT_FOUND,
  STATUS_OK,
  setCachedContent,
  shouldCache,
  shouldLogCacheSkip,
  shouldUseIpRotateForPlaywright,
  tryFetchWithIpRotate,
  tryGetCached,
  validateRequest,
} from '../src/playwright/core.ts';

interface MockKVNamespace {
  get: MockInstance;
  put: MockInstance;
  delete: MockInstance;
}

const createMockKV = (): MockKVNamespace => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
});

const createMockEnv = (
  kv?: MockKVNamespace,
  logRequests?: string,
  cacheVersion: string = 'v5',
): PlaywrightCoreEnv => ({
  KV: kv as unknown as KVNamespace,
  LOG_REQUESTS: logRequests,
  CACHE_VERSION: cacheVersion,
});

const createRequest = (url: string): Request =>
  new Request(`http://localhost${PLAYWRIGHT_PATH}?url=${encodeURIComponent(url)}`);

const createRequestWithParams = (params: string): Request =>
  new Request(`http://localhost${PLAYWRIGHT_PATH}?${params}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('constants', () => {
  it('PLAYWRIGHT_PATH exports correct path constant', () => {
    expect(PLAYWRIGHT_PATH).toBe('/playwright');
  });

  it('CACHE_TTL_SECONDS is 5 days', () => {
    expect(CACHE_TTL_SECONDS).toBe(432000);
  });
});

describe('type guards', () => {
  it('isFetchSuccess returns true for successful result', () => {
    const result: FetchPageResponse = { content: 'html', contentType: 'text/html', status: 200 };
    expect(isFetchSuccess(result)).toBe(true);
  });

  it('isFetchSuccess returns false for error result', () => {
    const result: FetchPageResponse = { error: 'failed' };
    expect(isFetchSuccess(result)).toBe(false);
  });

  it('isCacheableStatus returns true for 2xx and 3xx', () => {
    expect(isCacheableStatus(200)).toBe(true);
    expect(isCacheableStatus(301)).toBe(true);
    expect(isCacheableStatus(399)).toBe(true);
  });

  it('isCacheableStatus returns false for 4xx and 5xx', () => {
    expect(isCacheableStatus(400)).toBe(false);
    expect(isCacheableStatus(404)).toBe(false);
    expect(isCacheableStatus(500)).toBe(false);
  });
});

describe('utility functions', () => {
  it('isValidUrl returns true for valid URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://localhost:3000/path')).toBe(true);
  });

  it('isValidUrl returns false for invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });

  it('isHtmlContentType returns true for HTML content types', () => {
    expect(isHtmlContentType('text/html')).toBe(true);
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('TEXT/HTML')).toBe(true);
  });

  it('isHtmlContentType returns false for non-HTML content types', () => {
    expect(isHtmlContentType('application/json')).toBe(false);
    expect(isHtmlContentType('text/plain')).toBe(false);
  });

  it('getErrorMessage extracts message from Error', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('getErrorMessage returns default for non-Error', () => {
    expect(getErrorMessage('string error')).toBe('Unknown error during page fetch');
    expect(getErrorMessage(null)).toBe('Unknown error during page fetch');
  });

  it('createCacheKey creates correct format', () => {
    expect(createCacheKey('https://example.com', 'v5')).toBe('playwright-v5::https://example.com');
  });

  it('parseCachedContent parses JSON correctly', () => {
    const json = JSON.stringify({ content: 'html', contentType: 'text/html' });
    expect(parseCachedContent(json)).toEqual({ content: 'html', contentType: 'text/html' });
  });

  it('delay resolves after timeout', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe('logging', () => {
  it('isLoggingEnabled returns true when LOG_REQUESTS is TRUE', () => {
    expect(isLoggingEnabled({ LOG_REQUESTS: 'TRUE', CACHE_VERSION: 'v1' })).toBe(true);
    expect(isLoggingEnabled({ LOG_REQUESTS: 'true', CACHE_VERSION: 'v1' })).toBe(true);
  });

  it('isLoggingEnabled returns false when LOG_REQUESTS is not set', () => {
    expect(isLoggingEnabled({ CACHE_VERSION: 'v1' })).toBe(false);
    expect(isLoggingEnabled({ LOG_REQUESTS: 'false', CACHE_VERSION: 'v1' })).toBe(false);
  });

  it('logEvent logs when logging is enabled', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = createMockEnv(undefined, 'TRUE');

    logEvent(env, 'test-event', { target: 'test' });

    expect(consoleSpy).toHaveBeenCalledWith(LOG_PREFIX, 'test-event', { target: 'test' });
    consoleSpy.mockRestore();
  });

  it('logEvent does not log when logging is disabled', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = createMockEnv();

    logEvent(env, 'test-event', { target: 'test' });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('response creation', () => {
  it('createContentResponse creates response with correct headers', async () => {
    const response = createContentResponse({
      content: '<html>test</html>',
      contentType: CONTENT_TYPE_HTML,
      cacheStatus: CACHE_HIT,
    });

    expect(response.status).toBe(STATUS_OK);
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_HTML);
    expect(response.headers.get('x-cache')).toBe(CACHE_HIT);
    expect(await response.text()).toBe('<html>test</html>');
  });

  it('createErrorResponse creates JSON error response', async () => {
    const response = createErrorResponse('test error', STATUS_BAD_REQUEST);

    expect(response.status).toBe(STATUS_BAD_REQUEST);
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_JSON);
    expect(await response.json()).toEqual({ error: 'test error' });
  });

  it('createJsonResponse creates JSON response', async () => {
    const response = createJsonResponse({ key: 'value' }, STATUS_OK);

    expect(response.status).toBe(STATUS_OK);
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_JSON);
    expect(await response.json()).toEqual({ key: 'value' });
  });
});

describe('KV operations', () => {
  it('getCachedContent returns parsed content when exists', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(JSON.stringify({ content: 'html', contentType: 'text/html' }));

    const result = await getCachedContent(mockKV as unknown as KVNamespace, 'test-key');

    expect(result).toEqual({ content: 'html', contentType: 'text/html' });
    expect(mockKV.get).toHaveBeenCalledWith('test-key', 'text');
  });

  it('getCachedContent returns null when not found', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);

    const result = await getCachedContent(mockKV as unknown as KVNamespace, 'test-key');

    expect(result).toBeNull();
  });

  it('setCachedContent stores with TTL', async () => {
    const mockKV = createMockKV();
    mockKV.put.mockResolvedValue(undefined);

    await setCachedContent({
      kv: mockKV as unknown as KVNamespace,
      cacheKey: 'test-key',
      data: { content: 'html', contentType: 'text/html' },
    });

    expect(mockKV.put).toHaveBeenCalledWith(
      'test-key',
      JSON.stringify({ content: 'html', contentType: 'text/html' }),
      { expirationTtl: CACHE_TTL_SECONDS },
    );
  });

  it('deleteKvCache returns false when KV is undefined', async () => {
    const result = await deleteKvCache(undefined, 'test-key');
    expect(result).toBe(false);
  });

  it('deleteKvCache returns false when key does not exist', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);

    const result = await deleteKvCache(mockKV as unknown as KVNamespace, 'test-key');

    expect(result).toBe(false);
    expect(mockKV.delete).not.toHaveBeenCalled();
  });

  it('deleteKvCache deletes and returns true when key exists', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue('some-content');
    mockKV.delete.mockResolvedValue(undefined);

    const result = await deleteKvCache(mockKV as unknown as KVNamespace, 'test-key');

    expect(result).toBe(true);
    expect(mockKV.delete).toHaveBeenCalledWith('test-key');
  });
});

describe('request parsing and validation', () => {
  it('parseRequest extracts URL and flags', () => {
    const request = createRequestWithParams('url=https://example.com&disable_kv=true');
    const result = parseRequest(request);

    expect(result.targetUrl).toBe('https://example.com');
    expect(result.disableKv).toBe(true);
    expect(result.disableCache).toBe(false);
  });

  it('parseRequest handles disable_cache flag', () => {
    const request = createRequestWithParams('url=https://example.com&disable_cache=true');
    const result = parseRequest(request);

    expect(result.disableCache).toBe(true);
  });

  it('validateRequest returns error for missing URL', () => {
    const env = createMockEnv();
    const response = validateRequest(env, null);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(STATUS_BAD_REQUEST);
  });

  it('validateRequest returns error for invalid URL', () => {
    const env = createMockEnv();
    const response = validateRequest(env, 'not-a-url');

    expect(response).not.toBeNull();
    expect(response?.status).toBe(STATUS_BAD_REQUEST);
  });

  it('validateRequest returns null for valid URL', () => {
    const env = createMockEnv();
    const response = validateRequest(env, 'https://example.com');

    expect(response).toBeNull();
  });
});

describe('cache helpers', () => {
  it('shouldCache returns true when conditions are met', () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    expect(shouldCache(env, 200, false)).toBe(true);
  });

  it('shouldCache returns false when disableKv is true', () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    expect(shouldCache(env, 200, true)).toBe(false);
  });

  it('shouldCache returns false when KV is undefined', () => {
    const env = createMockEnv();
    expect(shouldCache(env, 200, false)).toBe(false);
  });

  it('shouldCache returns false for 4xx status', () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    expect(shouldCache(env, 404, false)).toBe(false);
  });

  it('shouldLogCacheSkip returns true when KV exists and status is 4xx', () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    expect(shouldLogCacheSkip(env, 404)).toBe(true);
  });

  it('shouldLogCacheSkip returns false when KV is undefined', () => {
    const env = createMockEnv();
    expect(shouldLogCacheSkip(env, 404)).toBe(false);
  });
});

describe('tryGetCached', () => {
  it('returns null when disableKv is true', async () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    const result = await tryGetCached({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: true,
      disableCache: false,
    });

    expect(result).toBeNull();
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  it('returns null when disableCache is true', async () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    const result = await tryGetCached({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: true,
    });

    expect(result).toBeNull();
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  it('returns null when KV is undefined', async () => {
    const env = createMockEnv();

    const result = await tryGetCached({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
    });

    expect(result).toBeNull();
  });

  it('returns null and logs cache-miss when not found', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    const env = createMockEnv(mockKV, 'TRUE');

    const result = await tryGetCached({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
    });

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(LOG_PREFIX, 'cache-miss', expect.any(Object));
    consoleSpy.mockRestore();
  });

  it('returns cached response on hit', async () => {
    const mockKV = createMockKV();
    const cachedData: CachedContent = {
      content: '<html>cached</html>',
      contentType: CONTENT_TYPE_HTML,
    };
    mockKV.get.mockResolvedValue(JSON.stringify(cachedData));
    const env = createMockEnv(mockKV);

    const result = await tryGetCached({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe(STATUS_OK);
    expect(result?.headers.get('x-cache')).toBe(CACHE_HIT);
    expect(await result?.text()).toBe('<html>cached</html>');
  });
});

describe('handleFetchError', () => {
  it('returns 502 with error message', async () => {
    const env = createMockEnv();
    const response = handleFetchError(env, 'https://example.com', 'connection failed');

    expect(response.status).toBe(STATUS_BAD_GATEWAY);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Browser fetch failed: connection failed');
  });
});

describe('handleFetchSuccess', () => {
  it('caches and returns response for successful fetch', async () => {
    const mockKV = createMockKV();
    mockKV.put.mockResolvedValue(undefined);
    const env = createMockEnv(mockKV);

    const response = await handleFetchSuccess({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      content: '<html>content</html>',
      contentType: CONTENT_TYPE_HTML,
      status: 200,
      disableKv: false,
    });

    expect(response.status).toBe(STATUS_OK);
    expect(response.headers.get('x-cache')).toBe(CACHE_MISS);
    expect(mockKV.put).toHaveBeenCalled();
  });

  it('does not cache when disableKv is true', async () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    await handleFetchSuccess({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      content: '<html>content</html>',
      contentType: CONTENT_TYPE_HTML,
      status: 200,
      disableKv: true,
    });

    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it('does not cache 4xx responses', async () => {
    const mockKV = createMockKV();
    const env = createMockEnv(mockKV);

    await handleFetchSuccess({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      content: 'not found',
      contentType: CONTENT_TYPE_HTML,
      status: 404,
      disableKv: false,
    });

    expect(mockKV.put).not.toHaveBeenCalled();
  });
});

describe('handleCoreRequest', () => {
  it('returns cached response when available', async () => {
    const mockKV = createMockKV();
    const cachedData: CachedContent = {
      content: '<html>cached</html>',
      contentType: CONTENT_TYPE_HTML,
    };
    mockKV.get.mockResolvedValue(JSON.stringify(cachedData));
    const env = createMockEnv(mockKV);
    const fetchPage = vi.fn();

    const response = await handleCoreRequest({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
      fetchPage,
    });

    expect(response.headers.get('x-cache')).toBe(CACHE_HIT);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('fetches and returns response on cache miss', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    mockKV.put.mockResolvedValue(undefined);
    const env = createMockEnv(mockKV);
    const fetchPage = vi.fn().mockResolvedValue({
      content: '<html>fetched</html>',
      contentType: CONTENT_TYPE_HTML,
      status: 200,
    });

    const response = await handleCoreRequest({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
      fetchPage,
    });

    expect(response.status).toBe(STATUS_OK);
    expect(response.headers.get('x-cache')).toBe(CACHE_MISS);
    expect(fetchPage).toHaveBeenCalled();
    expect(await response.text()).toBe('<html>fetched</html>');
  });

  it('returns error response on fetch failure', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    const env = createMockEnv(mockKV);
    const fetchPage = vi.fn().mockResolvedValue({ error: 'fetch failed' });

    const response = await handleCoreRequest({
      env,
      targetUrl: 'https://example.com',
      cacheKey: 'test-key',
      disableKv: false,
      disableCache: false,
      fetchPage,
    });

    expect(response.status).toBe(STATUS_BAD_GATEWAY);
  });
});

describe('handleDeleteRequest', () => {
  it('returns 400 for missing URL', async () => {
    const env = createMockEnv();
    const request = new Request(`http://localhost${PLAYWRIGHT_PATH}`);

    const response = await handleDeleteRequest(request, env);

    expect(response.status).toBe(STATUS_BAD_REQUEST);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(ERROR_MISSING_URL);
  });

  it('returns 400 for invalid URL', async () => {
    const env = createMockEnv();
    const request = createRequestWithParams('url=not-valid');

    const response = await handleDeleteRequest(request, env);

    expect(response.status).toBe(STATUS_BAD_REQUEST);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(ERROR_INVALID_URL);
  });

  it('returns 404 when cache entry does not exist', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    const env = createMockEnv(mockKV);
    const request = createRequest('https://example.com');

    const response = await handleDeleteRequest(request, env);

    expect(response.status).toBe(STATUS_NOT_FOUND);
    const body = (await response.json()) as { deleted: boolean; kvDeleted: boolean };
    expect(body.deleted).toBe(false);
    expect(body.kvDeleted).toBe(false);
  });

  it('returns 200 when cache entry is deleted', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue('cached-content');
    mockKV.delete.mockResolvedValue(undefined);
    const env = createMockEnv(mockKV);
    const request = createRequest('https://example.com');

    const response = await handleDeleteRequest(request, env);

    expect(response.status).toBe(STATUS_OK);
    const body = (await response.json()) as { deleted: boolean; kvDeleted: boolean };
    expect(body.deleted).toBe(true);
    expect(body.kvDeleted).toBe(true);
  });

  it('uses correct cache key format with cache version', async () => {
    const mockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    const env = createMockEnv(mockKV, undefined, 'v10');
    const request = createRequest('https://example.com/page');

    await handleDeleteRequest(request, env);

    expect(mockKV.get).toHaveBeenCalledWith('playwright-v10::https://example.com/page', 'text');
  });
});

it('parseIpRotateConfigFromEnv returns undefined when no endpoints', () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
  };
  const result = parseIpRotateConfigFromEnv(env);
  expect(result).toBeUndefined();
});

it('parseIpRotateConfigFromEnv returns config with valid endpoints', () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com","https://api2.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };
  const result = parseIpRotateConfigFromEnv(env);
  expect(result).toBeDefined();
  expect(result?.auth.type).toBe('api-key');
});

it('shouldUseIpRotateForPlaywright returns false when config is undefined', () => {
  const result = shouldUseIpRotateForPlaywright(undefined, new URL('https://example.com'));
  expect(result).toBe(false);
});

it('shouldUseIpRotateForPlaywright returns true when domain matches', () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };
  const config = parseIpRotateConfigFromEnv(env);
  const result = shouldUseIpRotateForPlaywright(config, new URL('https://example.com/path'));
  expect(result).toBe(true);
});

it('shouldUseIpRotateForPlaywright returns false when domain does not match', () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };
  const config = parseIpRotateConfigFromEnv(env);
  const result = shouldUseIpRotateForPlaywright(config, new URL('https://other.com/path'));
  expect(result).toBe(false);
});

it('tryFetchWithIpRotate returns null when config is undefined', async () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
  };
  const result = await tryFetchWithIpRotate(env, 'https://example.com', {
    config: undefined,
    counters: new Map(),
  });
  expect(result).toBeNull();
});

it('tryFetchWithIpRotate returns null when domain does not match', async () => {
  const env: PlaywrightCoreEnv = {
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };
  const config = parseIpRotateConfigFromEnv(env);
  const result = await tryFetchWithIpRotate(env, 'https://other.com', {
    config,
    counters: new Map(),
  });
  expect(result).toBeNull();
});

it('handleCoreRequest uses ip rotate when configured and domain matches', async () => {
  const mockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const env: PlaywrightCoreEnv = {
    KV: mockKV as unknown as KVNamespace,
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };

  const fetchPage = vi.fn().mockResolvedValue({
    content: '<html>browser</html>',
    contentType: CONTENT_TYPE_HTML,
    status: 200,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response('<html>ip-rotate</html>', {
      status: 200,
      headers: { 'content-type': CONTENT_TYPE_HTML },
    }),
  );

  const ipRotateConfig = parseIpRotateConfigFromEnv(env);

  const response = await handleCoreRequest({
    env,
    targetUrl: 'https://example.com/page',
    cacheKey: 'test-key',
    disableKv: false,
    disableCache: false,
    fetchPage,
    ipRotateOptions: {
      config: ipRotateConfig,
      counters: new Map(),
    },
  });

  expect(response.status).toBe(STATUS_OK);
  expect(await response.text()).toBe('<html>ip-rotate</html>');
  expect(fetchPage).not.toHaveBeenCalled();

  globalThis.fetch = originalFetch;
});

it('handleCoreRequest falls back to browser when ip rotate is not configured', async () => {
  const mockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const env = createMockEnv(mockKV);

  const fetchPage = vi.fn().mockResolvedValue({
    content: '<html>browser</html>',
    contentType: CONTENT_TYPE_HTML,
    status: 200,
  });

  const response = await handleCoreRequest({
    env,
    targetUrl: 'https://example.com/page',
    cacheKey: 'test-key',
    disableKv: false,
    disableCache: false,
    fetchPage,
    ipRotateOptions: undefined,
  });

  expect(response.status).toBe(STATUS_OK);
  expect(await response.text()).toBe('<html>browser</html>');
  expect(fetchPage).toHaveBeenCalled();
});

it('handleCoreRequest falls back to browser when domain does not match ip rotate config', async () => {
  const mockKV = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const env: PlaywrightCoreEnv = {
    KV: mockKV as unknown as KVNamespace,
    CACHE_VERSION: 'v1',
    IP_ROTATE_ENDPOINTS: '{"example.com":["https://api1.example.com"]}',
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'test-key',
  };

  const fetchPage = vi.fn().mockResolvedValue({
    content: '<html>browser</html>',
    contentType: CONTENT_TYPE_HTML,
    status: 200,
  });

  const ipRotateConfig = parseIpRotateConfigFromEnv(env);

  const response = await handleCoreRequest({
    env,
    targetUrl: 'https://other.com/page',
    cacheKey: 'test-key',
    disableKv: false,
    disableCache: false,
    fetchPage,
    ipRotateOptions: {
      config: ipRotateConfig,
      counters: new Map(),
    },
  });

  expect(response.status).toBe(STATUS_OK);
  expect(await response.text()).toBe('<html>browser</html>');
  expect(fetchPage).toHaveBeenCalled();
});
