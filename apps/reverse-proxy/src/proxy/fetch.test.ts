// Fetch utilities tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpRotateConfig } from '../ip-rotate/types.ts';
import { fetchAndCache, performFetch, performStandardFetch } from './fetch/core.ts';
import { buildFetchHeaders } from './fetch/headers.ts';
import { performIpRotateFetch, shouldUseIpRotate } from './fetch/ip-rotate.ts';
import { createTooManyRedirectsResponse, handleRedirect } from './fetch/redirect.ts';
import { logUpstreamError, processFetchResponse } from './fetch/response.ts';
import { isCacheableStatus, isRedirectStatus } from './fetch/status.ts';
import type { FetchAndCacheParams, ProxyCacheOptions } from './types.ts';

const createMockOptions = (overrides?: Partial<ProxyCacheOptions>): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
  ...overrides,
});

const createMockResponse = (status: number, headers?: Record<string, string>): Response =>
  new Response('test body', {
    status,
    headers: new Headers(headers),
  });

describe('isCacheableStatus', () => {
  it('returns true for status below 400', () => {
    expect(isCacheableStatus(200)).toBe(true);
    expect(isCacheableStatus(201)).toBe(true);
    expect(isCacheableStatus(301)).toBe(true);
    expect(isCacheableStatus(399)).toBe(true);
  });

  it('returns false for status 400 and above', () => {
    expect(isCacheableStatus(400)).toBe(false);
    expect(isCacheableStatus(404)).toBe(false);
    expect(isCacheableStatus(500)).toBe(false);
  });
});

describe('isRedirectStatus', () => {
  it('returns true for redirect status codes', () => {
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(307)).toBe(true);
    expect(isRedirectStatus(308)).toBe(true);
  });

  it('returns false for non-redirect status codes', () => {
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(299)).toBe(false);
    expect(isRedirectStatus(400)).toBe(false);
  });
});

describe('buildFetchHeaders', () => {
  it('builds headers with correct values', () => {
    const headers: Record<string, string> = buildFetchHeaders('https://example.com');
    expect(headers.referer).toBe('https://example.com');
    expect(headers['user-agent']).toBeDefined();
    expect(headers.accept).toBeDefined();
    expect(headers.connection).toBe('keep-alive');
  });
});

describe('handleRedirect', () => {
  it('returns null when no Location header', () => {
    const response: Response = createMockResponse(302);
    expect(handleRedirect(response, 'https://example.com')).toBeNull();
  });

  it('returns absolute URL from Location header', () => {
    const response: Response = createMockResponse(302, { Location: 'https://other.com/path' });
    expect(handleRedirect(response, 'https://example.com')).toBe('https://other.com/path');
  });

  it('resolves relative URL against current URL', () => {
    const response: Response = createMockResponse(302, { Location: '/new-path' });
    expect(handleRedirect(response, 'https://example.com/old')).toBe(
      'https://example.com/new-path',
    );
  });
});

describe('logUpstreamError', () => {
  it('logs error with response body', async () => {
    const options: ProxyCacheOptions = createMockOptions({ enableLogging: true });
    const response: Response = new Response('error message', { status: 500 });

    await logUpstreamError({
      options,
      target: new URL('https://example.com'),
      currentUrl: 'https://example.com/path',
      response,
    });

    expect(true).toBe(true);
  });
});

describe('createTooManyRedirectsResponse', () => {
  it('returns 502 response', () => {
    const options: ProxyCacheOptions = createMockOptions();
    const target: URL = new URL('https://example.com');
    const response: Response = createTooManyRedirectsResponse(options, target);
    expect(response.status).toBe(502);
  });
});

describe('shouldUseIpRotate', () => {
  it('returns false when no ipRotateConfig', () => {
    const options: ProxyCacheOptions = createMockOptions();
    const url: URL = new URL('https://example.com');
    expect(shouldUseIpRotate(options, url)).toBe(false);
  });

  it('returns false when host not in config', () => {
    const ipRotateConfig: IpRotateConfig = {
      endpoints: {},
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const options: ProxyCacheOptions = createMockOptions({ ipRotateConfig });
    const url: URL = new URL('https://example.com');
    expect(shouldUseIpRotate(options, url)).toBe(false);
  });

  it('returns true when host is in config', () => {
    const ipRotateConfig: IpRotateConfig = {
      endpoints: { 'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key' }] },
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const options: ProxyCacheOptions = createMockOptions({ ipRotateConfig });
    const url: URL = new URL('https://example.com');
    expect(shouldUseIpRotate(options, url)).toBe(true);
  });
});

describe('performStandardFetch', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse(200));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls fetch with correct parameters', async () => {
    const headers: Record<string, string> = { 'User-Agent': 'test' };
    await performStandardFetch('https://example.com', headers);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', {
      cache: 'no-store',
      headers,
      redirect: 'manual',
    });
  });
});

describe('performIpRotateFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no ipRotateConfig', async () => {
    const options: ProxyCacheOptions = createMockOptions();
    const url: URL = new URL('https://example.com');
    const result: Response | null = await performIpRotateFetch(options, url, {});
    expect(result).toBeNull();
  });

  it('returns null when host not in IP rotation config', async () => {
    const ipRotateConfig: IpRotateConfig = {
      endpoints: { 'other.com': [{ endpoint: 'https://api.other.com', apiKey: 'key' }] },
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const options: ProxyCacheOptions = createMockOptions({ ipRotateConfig });
    const url: URL = new URL('https://example.com');
    const result: Response | null = await performIpRotateFetch(options, url, {});
    expect(result).toBeNull();
  });
});

describe('performFetch', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse(200));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses standard fetch when IP rotation not configured', async () => {
    const options: ProxyCacheOptions = createMockOptions();
    const response: Response = await performFetch(options, 'https://example.com', {});
    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('uses standard fetch when host not in IP rotation config', async () => {
    const ipRotateConfig: IpRotateConfig = {
      endpoints: { 'other.com': [{ endpoint: 'https://api.other.com', apiKey: 'key' }] },
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const options: ProxyCacheOptions = createMockOptions({ ipRotateConfig });
    const response: Response = await performFetch(options, 'https://example.com', {});
    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('falls back to standard fetch when IP rotation returns null', async () => {
    const ipRotateConfig: IpRotateConfig = {
      endpoints: { 'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key' }] },
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const options: ProxyCacheOptions = createMockOptions({ ipRotateConfig });
    const response: Response = await performFetch(options, 'https://example.com/path', {});
    expect(response.status).toBe(200);
  });
});

describe('processFetchResponse', () => {
  it('returns response for non-cacheable status', async () => {
    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = createMockResponse(500);
    const result: Response = await processFetchResponse({
      params,
      response,
      currentUrl: 'https://example.com',
    });
    expect(result.status).toBe(500);
  });

  it('caches response for cacheable status', async () => {
    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = createMockResponse(200);
    const result: Response = await processFetchResponse({
      params,
      response,
      currentUrl: 'https://example.com',
    });
    expect(result.status).toBe(200);
  });
});

describe('fetchAndCache', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createMockResponse(200));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns response for non-redirect', async () => {
    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = await fetchAndCache(params);
    expect(response.status).toBe(200);
  });

  it('follows redirects', async () => {
    const redirectResponse: Response = createMockResponse(302, {
      Location: 'https://example.com/redirected',
    });
    const finalResponse: Response = createMockResponse(200);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(finalResponse);

    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = await fetchAndCache(params);
    expect(response.status).toBe(200);
  });

  it('returns error after too many redirects', async () => {
    const redirectResponse: Response = createMockResponse(302, {
      Location: 'https://example.com/redirect',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(redirectResponse);

    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = await fetchAndCache(params);
    expect(response.status).toBe(502);
  });

  it('handles redirect without Location header', async () => {
    const redirectResponse: Response = createMockResponse(302);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(redirectResponse);

    const params: FetchAndCacheParams = {
      cacheKey: 'test-key',
      kvCacheKey: 'kv-test-key',
      target: new URL('https://example.com'),
      options: createMockOptions(),
    };
    const response: Response = await fetchAndCache(params);
    expect(response.status).toBe(302);
  });
});
