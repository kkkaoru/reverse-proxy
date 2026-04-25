// IP Rotation fetch tests
// Execute with bun: bun test

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ABSOLUTE_MAX_RETRIES,
  ACCEPT_ENCODING_IDENTITY,
  buildHealthKey,
  buildThrottleKey,
  calculateMaxRetries,
  calculateThrottleDelay,
  clampTimeout,
  DEFAULT_HEDGE_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  defaultTimeoutConfig,
  drainResponseBody,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  ERROR_WALL_CLOCK_TIMEOUT,
  EXTRA_RETRIES_PER_BLACKLIST,
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  getRecentlyFailedIndices,
  getRecentlyThrottledIndices,
  HEALTH_TTL_MS,
  HEDGE_ATTEMPT_COST,
  HEDGE_SUPPRESS_THRESHOLD,
  hashUrl,
  isRetriableStatus,
  isServerErrorStatus,
  isTimeoutError,
  MAX_HEDGE_ATTEMPTS,
  MAX_RETRIES_MULTIPLIER,
  MAX_TIMEOUT_MS,
  MIN_RETRIES,
  MIN_TIMEOUT_MS,
  parseEnvTimeout,
  parsePositiveIntEnv,
  recordEndpointFailure,
  recordEndpointThrottle,
  resolveTuning,
  STATUS_SERVER_ERROR_START,
  STATUS_TOO_MANY_REQUESTS,
  STATUS_WORKER_RESOURCE_EXHAUSTED,
  stripCompressionEncoding,
  THROTTLE_BACKOFF_MULTIPLIER,
  THROTTLE_BASE_DELAY_MS,
  THROTTLE_JITTER_RATIO,
  THROTTLE_MAX_DELAY_MS,
  THROTTLE_TTL_MS,
  TIMEOUT_BOOST_PER_BLACKLIST_MS,
} from './fetch.ts';
import { getEndpointResponseTimes } from './metrics.ts';

type FetchFn = typeof globalThis.fetch;

let originalFetch: FetchFn;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test('STATUS_SERVER_ERROR_START is 500', () => {
  expect(STATUS_SERVER_ERROR_START).toBe(500);
});

test('STATUS_TOO_MANY_REQUESTS is 429', () => {
  expect(STATUS_TOO_MANY_REQUESTS).toBe(429);
});

test('DEFAULT_TIMEOUT_MS is 2000', () => {
  expect(DEFAULT_TIMEOUT_MS).toBe(2000);
});

test('MIN_TIMEOUT_MS is 2000', () => {
  expect(MIN_TIMEOUT_MS).toBe(2000);
});

test('MAX_TIMEOUT_MS is 8000', () => {
  expect(MAX_TIMEOUT_MS).toBe(8000);
});

test('MIN_RETRIES is 5', () => {
  expect(MIN_RETRIES).toBe(5);
});

test('HEALTH_TTL_MS is 60000', () => {
  expect(HEALTH_TTL_MS).toBe(60000);
});

test('EXTRA_RETRIES_PER_BLACKLIST is 2', () => {
  expect(EXTRA_RETRIES_PER_BLACKLIST).toBe(2);
});

test('MAX_RETRIES_MULTIPLIER is 3', () => {
  expect(MAX_RETRIES_MULTIPLIER).toBe(3);
});

test('TIMEOUT_BOOST_PER_BLACKLIST_MS is 500', () => {
  expect(TIMEOUT_BOOST_PER_BLACKLIST_MS).toBe(500);
});

test('ERROR_ALL_ENDPOINTS_FAILED message', () => {
  expect(ERROR_ALL_ENDPOINTS_FAILED).toBe('All endpoints failed');
});

test('ERROR_NO_ENDPOINTS_AVAILABLE message', () => {
  expect(ERROR_NO_ENDPOINTS_AVAILABLE).toBe('No endpoints available for domain');
});

test('defaultTimeoutConfig defaultMs', () => {
  expect(defaultTimeoutConfig.defaultMs).toBe(2000);
});

test('defaultTimeoutConfig minMs', () => {
  expect(defaultTimeoutConfig.minMs).toBe(2000);
});

test('defaultTimeoutConfig maxMs', () => {
  expect(defaultTimeoutConfig.maxMs).toBe(8000);
});

test('isRetriableStatus true for 500', () => {
  expect(isRetriableStatus(500)).toBe(true);
});

test('isRetriableStatus true for 502', () => {
  expect(isRetriableStatus(502)).toBe(true);
});

test('isRetriableStatus true for 503', () => {
  expect(isRetriableStatus(503)).toBe(true);
});

test('isRetriableStatus true for 429', () => {
  expect(isRetriableStatus(429)).toBe(true);
});

test('isRetriableStatus false for 200', () => {
  expect(isRetriableStatus(200)).toBe(false);
});

test('isRetriableStatus true for 400 (api gateway throttle)', () => {
  expect(isRetriableStatus(400)).toBe(true);
});

test('isRetriableStatus false for 403', () => {
  expect(isRetriableStatus(403)).toBe(false);
});

test('isRetriableStatus false for 404', () => {
  expect(isRetriableStatus(404)).toBe(false);
});

test('STATUS_WORKER_RESOURCE_EXHAUSTED is 533', () => {
  expect(STATUS_WORKER_RESOURCE_EXHAUSTED).toBe(533);
});

test('isRetriableStatus false for 533 (worker resource exhausted)', () => {
  expect(isRetriableStatus(533)).toBe(false);
});

test('ABSOLUTE_MAX_RETRIES is 20', () => {
  expect(ABSOLUTE_MAX_RETRIES).toBe(20);
});

test('isServerErrorStatus true for 500', () => {
  expect(isServerErrorStatus(500)).toBe(true);
});

test('isServerErrorStatus true for 502', () => {
  expect(isServerErrorStatus(502)).toBe(true);
});

test('isServerErrorStatus false for 200', () => {
  expect(isServerErrorStatus(200)).toBe(false);
});

test('isServerErrorStatus false for 429', () => {
  expect(isServerErrorStatus(429)).toBe(false);
});

test('isServerErrorStatus false for 404', () => {
  expect(isServerErrorStatus(404)).toBe(false);
});

test('calculateMaxRetries for 3 endpoints returns min 5', () => {
  expect(calculateMaxRetries(3)).toBe(5);
});

test('calculateMaxRetries for 5 endpoints returns 5', () => {
  expect(calculateMaxRetries(5)).toBe(5);
});

test('calculateMaxRetries for 10 endpoints returns 10', () => {
  expect(calculateMaxRetries(10)).toBe(10);
});

test('calculateMaxRetries for 25 endpoints returns 20 (capped)', () => {
  expect(calculateMaxRetries(25)).toBe(20);
});

test('calculateMaxRetries for 51 endpoints returns 20 (capped)', () => {
  expect(calculateMaxRetries(51)).toBe(20);
});

test('calculateMaxRetries for 1 endpoint returns min 5', () => {
  expect(calculateMaxRetries(1)).toBe(5);
});

test('calculateMaxRetries for 0 endpoints returns min 5', () => {
  expect(calculateMaxRetries(0)).toBe(5);
});

test('parseEnvTimeout undefined', () => {
  expect(parseEnvTimeout(undefined)).toBeNull();
});

test('parseEnvTimeout empty string', () => {
  expect(parseEnvTimeout('')).toBeNull();
});

test('parseEnvTimeout non-numeric', () => {
  expect(parseEnvTimeout('abc')).toBeNull();
});

test('parseEnvTimeout numeric string', () => {
  expect(parseEnvTimeout('5000')).toBe(5000);
});

test('parseEnvTimeout leading zeros', () => {
  expect(parseEnvTimeout('0100')).toBe(100);
});

test('getDefaultTimeoutFromEnv undefined', () => {
  expect(getDefaultTimeoutFromEnv(undefined)).toBe(2000);
});

test('getDefaultTimeoutFromEnv valid', () => {
  expect(getDefaultTimeoutFromEnv('5000')).toBe(5000);
});

test('getDefaultTimeoutFromEnv invalid', () => {
  expect(getDefaultTimeoutFromEnv('invalid')).toBe(2000);
});

test('clampTimeout below min', () => {
  expect(clampTimeout(500, defaultTimeoutConfig)).toBe(2000);
});

test('clampTimeout above max', () => {
  expect(clampTimeout(15000, defaultTimeoutConfig)).toBe(8000);
});

test('clampTimeout within range', () => {
  expect(clampTimeout(5000, defaultTimeoutConfig)).toBe(5000);
});

test('clampTimeout negative', () => {
  expect(clampTimeout(-100, defaultTimeoutConfig)).toBe(2000);
});

test('isTimeoutError true for TimeoutError', () => {
  const error: Error = new Error('timeout');
  error.name = 'TimeoutError';
  expect(isTimeoutError(error)).toBe(true);
});

test('isTimeoutError false for Error', () => {
  const error: Error = new Error('error');
  expect(isTimeoutError(error)).toBe(false);
});

test('isTimeoutError false for string', () => {
  expect(isTimeoutError('string error')).toBe(false);
});

test('isTimeoutError false for null', () => {
  expect(isTimeoutError(null)).toBe(false);
});

test('isTimeoutError false for undefined', () => {
  expect(isTimeoutError(undefined)).toBe(false);
});

test('fetchWithAuth unsupported auth type', async () => {
  const params = {
    url: new URL('https://example.com'),
    auth: { type: 'unknown' as const },
    headers: {},
    method: 'GET',
  };
  await expect(
    fetchWithAuth(params as unknown as Parameters<typeof fetchWithAuth>[0]),
  ).rejects.toThrow('Unsupported auth type: unknown');
});

test('fetchWithAuth with IAM auth', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'));

  const params = {
    url: new URL('https://example.com'),
    auth: { type: 'iam' as const, accessKeyId: 'key', secretAccessKey: 'secret', region: 'region' },
    headers: {},
    method: 'GET',
  };

  const response: Response = await fetchWithAuth(params);
  expect(response).toBeDefined();
});

test('fetchWithRetry no endpoints', async () => {
  const result = await fetchWithRetry({
    config: {
      endpoints: {},
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBe('No endpoints available for domain');
    expect(result.errorCode).toBe('NO_ENDPOINTS');
    expect(result.totalAttempts).toBe(0);
  }
});

test('fetchWithRetry custom timeout', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    timeoutMs: 5000,
  });

  expect(result.success).toBe(true);
});

test('fetchWithRetry env timeout', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    envDefaultTimeoutMs: '4000',
  });

  expect(result.success).toBe(true);
});

test('fetchWithRetry retries on 5xx error status', async () => {
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount < 3) {
      return Promise.resolve(new Response('error', { status: 500 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  expect(callCount).toBe(3);
});

test('fetchWithRetry max retries with 5xx', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBe('All endpoints failed');
    expect(result.errorCode).toBe('MAX_RETRIES');
    expect(result.totalAttempts).toBeGreaterThan(0);
  }
});

test('fetchWithRetry handles timeout', async () => {
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount < 2) {
      const error: Error = new Error('timeout');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    timeoutMs: 3000,
  });

  expect(result.success).toBe(true);
  expect(callCount).toBe(2);
});

test('fetchWithRetry clamps to min', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    timeoutMs: 100,
  });

  expect(result.success).toBe(true);
});

test('fetchWithRetry clamps to max', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    timeoutMs: 20000,
  });

  expect(result.success).toBe(true);
});

test('fetchWithAuth api-key auth', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const result: Response = await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'api-key', apiKey: 'test-key' },
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    body: '{}',
  });

  expect(result.status).toBe(200);
});

test('fetchWithAuth passes signal', async () => {
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal | undefined;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const signal: AbortSignal = AbortSignal.timeout(5000);
  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'api-key', apiKey: 'test-key' },
    headers: {},
    method: 'GET',
    signal,
  });

  expect(receivedSignal).toBeDefined();
});

test('fetchWithRetry propagates non-timeout errors', async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

  await expect(
    fetchWithRetry({
      config: {
        endpoints: {
          'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
        },
        auth: { type: 'api-key', apiKey: 'key' },
      },
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    }),
  ).rejects.toThrow('Network error');
});

test('fetchWithRetry uses correct endpoint-specific API key on each retry', async () => {
  const capturedApiKeys: string[] = [];

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const apiKey = headers?.['x-api-key'];
    if (apiKey) {
      capturedApiKeys.push(apiKey);
    }
    // Return 5xx error to trigger retry
    return Promise.resolve(new Response('error', { status: 500 }));
  });

  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'endpoint-key-1' },
          { endpoint: 'https://api2.example.com', apiKey: 'endpoint-key-2' },
          { endpoint: 'https://api3.example.com', apiKey: 'endpoint-key-3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'base-key-should-not-be-used' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  // Verify endpoint-specific keys are used, not the base key
  expect(capturedApiKeys[0]).toBe('endpoint-key-1');
  expect(capturedApiKeys[1]).toBe('endpoint-key-2');
  expect(capturedApiKeys[2]).toBe('endpoint-key-3');
});

test('fetchWithRetry correctly matches URL and API key on each request', async () => {
  const capturedRequests: Array<{ url: string; apiKey: string }> = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const apiKey = headers?.['x-api-key'] ?? '';
    capturedRequests.push({ url, apiKey });
    // Return 502 error to trigger retry
    return Promise.resolve(new Response('error', { status: 502 }));
  });

  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://gateway-1.example.com', apiKey: 'key-for-gateway-1' },
          { endpoint: 'https://gateway-2.example.com', apiKey: 'key-for-gateway-2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'base-key' },
    },
    targetUrl: new URL('https://example.com/test/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  // Verify round-robin order with correct keys
  expect(capturedRequests[0]?.apiKey).toBe('key-for-gateway-1');
  expect(capturedRequests[1]?.apiKey).toBe('key-for-gateway-2');
});

test('fetchWithRetry returns lastUsedEndpoint on failure', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 502 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://gateway-1.example.com', apiKey: 'key1' },
          { endpoint: 'https://gateway-2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'base-key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.lastResponse).not.toBeNull();
    expect(result.lastResponse?.status).toBe(502);
    expect(result.lastUsedEndpoint).not.toBeNull();
  }
});

test('ERROR_WALL_CLOCK_TIMEOUT message', () => {
  expect(ERROR_WALL_CLOCK_TIMEOUT).toBe('Wall clock timeout exceeded');
});

test('fetchWithRetry stops retries when wallClockSignal is aborted', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));

  const controller: AbortController = new AbortController();
  controller.abort();

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    wallClockSignal: controller.signal,
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBe('Wall clock timeout exceeded');
    expect(result.errorCode).toBe('WALL_CLOCK_TIMEOUT');
    expect(result.totalAttempts).toBe(0);
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('fetchWithRetry stops retries mid-loop when wallClockSignal aborts', async () => {
  let callCount: number = 0;
  const controller: AbortController = new AbortController();

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount >= 2) {
      controller.abort();
    }
    return Promise.resolve(new Response('error', { status: 500 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    wallClockSignal: controller.signal,
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBe('Wall clock timeout exceeded');
    expect(result.errorCode).toBe('WALL_CLOCK_TIMEOUT');
  }
  // Should have stopped after 2 calls, not retried all
  expect(callCount).toBe(2);
});

test('fetchWithRetry passes wallClockSignal without affecting normal success', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

  const controller: AbortController = new AbortController();

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    wallClockSignal: controller.signal,
  });

  expect(result.success).toBe(true);
});

// Bug 3: 4xx should not trigger retry
test('fetchWithRetry returns 404 as success without retry', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.response.status).toBe(404);
  }
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('fetchWithRetry retries 400 (api gateway throttle) and surfaces final 400', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('Bad Request', { status: 400 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(false);
  expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
});

test('fetchWithRetry retries on 429 throttled', async () => {
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  expect(callCount).toBe(2);
});

// 5xx blacklisting test
test('fetchWithRetry blacklists 5xx endpoints and does not retry them', async () => {
  const capturedUrls: string[] = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    if (url.startsWith('https://api1.example.com')) {
      return Promise.resolve(new Response('error', { status: 502 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // api1 was tried first (502), then api2 (200)
  expect(capturedUrls[0]).toBe('https://api1.example.com/path');
  expect(capturedUrls[1]).toBe('https://api2.example.com/path');
  expect(capturedUrls.length).toBe(2);
});

// G-1: Cross-request health tracking
test('buildHealthKey builds correct key with urlHash', () => {
  expect(buildHealthKey('example.com', 'deadbeef', 0)).toBe('5xx:example.com:deadbeef:0');
  expect(buildHealthKey('example.com', 'cafebabe', 2)).toBe('5xx:example.com:cafebabe:2');
});

test('recordEndpointFailure records timestamp to counters', () => {
  const counters: Map<string, number> = new Map();
  const before: number = Date.now();
  recordEndpointFailure({ counters, domain: 'example.com', urlHash: 'hash1', index: 1 });
  const after: number = Date.now();

  const recorded: number | undefined = counters.get('5xx:example.com:hash1:1');
  expect(recorded).toBeDefined();
  expect(recorded).toBeGreaterThanOrEqual(before);
  expect(recorded).toBeLessThanOrEqual(after);
});

test('getRecentlyFailedIndices returns recent failures', () => {
  const counters: Map<string, number> = new Map();
  counters.set('5xx:example.com:hash1:0', Date.now());
  counters.set('5xx:example.com:hash1:2', Date.now());

  const result: Set<number> = getRecentlyFailedIndices({
    counters,
    domain: 'example.com',
    urlHash: 'hash1',
    endpointCount: 3,
  });

  expect(result.has(0)).toBe(true);
  expect(result.has(1)).toBe(false);
  expect(result.has(2)).toBe(true);
});

test('getRecentlyFailedIndices excludes expired failures', () => {
  const counters: Map<string, number> = new Map();
  // Set failure time to be older than TTL
  counters.set('5xx:example.com:hash1:0', Date.now() - 120000);

  const result: Set<number> = getRecentlyFailedIndices({
    counters,
    domain: 'example.com',
    urlHash: 'hash1',
    endpointCount: 2,
  });

  expect(result.has(0)).toBe(false);
  expect(result.has(1)).toBe(false);
});

test('getRecentlyFailedIndices isolates failures across different urlHashes', () => {
  const counters: Map<string, number> = new Map();
  counters.set('5xx:example.com:urlA:0', Date.now());

  const hitForA: Set<number> = getRecentlyFailedIndices({
    counters,
    domain: 'example.com',
    urlHash: 'urlA',
    endpointCount: 2,
  });
  const hitForB: Set<number> = getRecentlyFailedIndices({
    counters,
    domain: 'example.com',
    urlHash: 'urlB',
    endpointCount: 2,
  });

  expect(hitForA.has(0)).toBe(true);
  expect(hitForB.has(0)).toBe(false);
});

test('fetchWithRetry deprioritizes recently failed endpoints (G-1)', async () => {
  const capturedUrls: string[] = [];
  const counters: Map<string, number> = new Map();
  // Mark endpoint 0 as recently failed FOR THIS URL
  const targetUrlString: string = 'https://example.com/path';
  const targetHash: string = hashUrl(targetUrlString);
  counters.set(`5xx:example.com:${targetHash}:0`, Date.now());

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // Should try api2 first since api1 (index 0) was recently failed
  expect(capturedUrls[0]).toBe('https://api2.example.com/path');
  expect(capturedUrls.length).toBe(1);
});

// G-2: maxRetries extension on blacklist
test('fetchWithRetry extends maxRetries when 5xx blacklists endpoint (G-2)', async () => {
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    callCount++;
    // First 2 endpoints always return 502
    if (url.startsWith('https://api1.example.com') || url.startsWith('https://api2.example.com')) {
      return Promise.resolve(new Response('error', { status: 502 }));
    }
    // Third endpoint succeeds eventually
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // api1 (502) -> api2 (502) -> api3 (200)
  expect(callCount).toBe(3);
});

// G-4: Timeout records to counters
test('fetchWithRetry records timeout to counters for deprioritization (G-4)', async () => {
  let callCount: number = 0;
  const counters: Map<string, number> = new Map();

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      const error: Error = new Error('timeout');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // Timeout should have recorded endpoint 0 failure in counters (URL-scoped)
  const timeoutKeyHash: string = hashUrl('https://example.com/path');
  expect(counters.has(`5xx:example.com:${timeoutKeyHash}:0`)).toBe(true);
});

// G-4: Timeout does not blacklist (only soft deprioritization)
test('fetchWithRetry does not blacklist timed-out endpoints', async () => {
  const capturedUrls: string[] = [];
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    callCount++;
    if (callCount === 1) {
      const error: Error = new Error('timeout');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }
    if (callCount === 2) {
      const error: Error = new Error('timeout');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }
    // After round-robin reset, api1 should be retried (not blacklisted)
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // api1 timeout -> api2 timeout -> reset -> api1 retried (not blacklisted) -> success
  expect(capturedUrls[0]).toBe('https://api1.example.com/path');
  expect(capturedUrls[1]).toBe('https://api2.example.com/path');
  expect(capturedUrls[2]).toBe('https://api1.example.com/path');
});

// All endpoints blacklisted -> fail immediately
test('fetchWithRetry fails when all endpoints are blacklisted', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 502 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error).toBe('All endpoints failed');
    expect(result.errorCode).toBe('MAX_RETRIES');
  }
});

// Throttle backoff constants
test('THROTTLE_BASE_DELAY_MS is 100', () => {
  expect(THROTTLE_BASE_DELAY_MS).toBe(100);
});

test('THROTTLE_MAX_DELAY_MS is 1000', () => {
  expect(THROTTLE_MAX_DELAY_MS).toBe(1000);
});

test('THROTTLE_BACKOFF_MULTIPLIER is 2', () => {
  expect(THROTTLE_BACKOFF_MULTIPLIER).toBe(2);
});

test('THROTTLE_JITTER_RATIO is 0.3', () => {
  expect(THROTTLE_JITTER_RATIO).toBe(0.3);
});

test('THROTTLE_TTL_MS is 10000', () => {
  expect(THROTTLE_TTL_MS).toBe(10000);
});

test('HEDGE_SUPPRESS_THRESHOLD is 3', () => {
  expect(HEDGE_SUPPRESS_THRESHOLD).toBe(3);
});

// calculateThrottleDelay tests (Math.random mocked to 0 in beforeEach)
test('calculateThrottleDelay returns 100 for first throttle', () => {
  expect(calculateThrottleDelay(0)).toBe(100);
});

test('calculateThrottleDelay returns 200 for second throttle', () => {
  expect(calculateThrottleDelay(1)).toBe(200);
});

test('calculateThrottleDelay returns 400 for third throttle', () => {
  expect(calculateThrottleDelay(2)).toBe(400);
});

test('calculateThrottleDelay returns 800 for fourth throttle', () => {
  expect(calculateThrottleDelay(3)).toBe(800);
});

test('calculateThrottleDelay caps at 1000 for fifth throttle', () => {
  expect(calculateThrottleDelay(4)).toBe(1000);
});

test('calculateThrottleDelay caps at 1000 for large consecutive count', () => {
  expect(calculateThrottleDelay(10)).toBe(1000);
});

test('calculateThrottleDelay includes proportional jitter when random is non-zero', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  // base=100, jitterRange=floor(100*0.3)=30, jitter=floor(0.5*30)=15
  expect(calculateThrottleDelay(0)).toBe(115);
});

// 429 backoff integration test
test('fetchWithRetry applies backoff delay on consecutive 429s', async () => {
  let callCount: number = 0;
  const callTimestamps: number[] = [];

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    callTimestamps.push(Date.now());
    if (callCount <= 2) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  expect(callCount).toBe(3);
  expect(callTimestamps).toHaveLength(3);
  // Verify delays occurred (first delay ~100ms, second ~200ms)
  const firstDelay: number = (callTimestamps.at(1) ?? 0) - (callTimestamps.at(0) ?? 0);
  const secondDelay: number = (callTimestamps.at(2) ?? 0) - (callTimestamps.at(1) ?? 0);
  expect(firstDelay).toBeGreaterThanOrEqual(80);
  expect(secondDelay).toBeGreaterThanOrEqual(160);
});

// 429 backoff resets on non-429 response
test('fetchWithRetry resets throttle counter on server error after 429', async () => {
  let callCount: number = 0;
  const callTimestamps: number[] = [];

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    callTimestamps.push(Date.now());
    if (callCount === 1) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    if (callCount === 2) {
      return Promise.resolve(new Response('Server Error', { status: 500 }));
    }
    if (callCount === 3) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
          { endpoint: 'https://api4.example.com', apiKey: 'key4' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  expect(callCount).toBe(4);
  // Third call is 429 again but after a 500 (which resets consecutiveThrottles to 0)
  // So the delay before call 4 should be ~100ms (base delay), not ~200ms
  const thirdDelay: number = (callTimestamps.at(3) ?? 0) - (callTimestamps.at(2) ?? 0);
  expect(thirdDelay).toBeGreaterThanOrEqual(80);
  expect(thirdDelay).toBeLessThan(250);
});

// 429 backoff log message includes delay
test('fetchWithRetry logs throttle delay on 429', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(consoleSpy).toHaveBeenCalledWith('[ip-rotate]', {
    event: 'retry',
    attempt: 0,
    endpoint: 'https://api1.example.com',
    reason: 'throttled',
    delayMs: 100,
  });
  consoleSpy.mockRestore();
});

// Hedge request constants
test('DEFAULT_HEDGE_DELAY_MS is 500', () => {
  expect(DEFAULT_HEDGE_DELAY_MS).toBe(500);
});

test('MAX_HEDGE_ATTEMPTS is 2', () => {
  expect(MAX_HEDGE_ATTEMPTS).toBe(2);
});

test('HEDGE_ATTEMPT_COST is 2', () => {
  expect(HEDGE_ATTEMPT_COST).toBe(2);
});

// Hedge: fast primary completes before hedge delay, no hedge fired
test('fetchWithRetry does not fire hedge when primary responds fast', async () => {
  const capturedUrls: string[] = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // Only 1 fetch made - no hedge needed since primary was fast
  expect(capturedUrls).toHaveLength(1);
});

// Hedge: slow primary triggers hedge, hedge wins
test('fetchWithRetry fires hedge when primary is slow and hedge wins', async () => {
  const capturedUrls: string[] = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    // First endpoint (primary) is slow - takes longer than hedge delay
    if (url.startsWith('https://api1.example.com')) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response('slow', { status: 200 })), 2000);
      });
    }
    // Second endpoint (hedge) responds fast
    return Promise.resolve(new Response('fast', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // Primary + hedge = 2 fetch calls
  expect(capturedUrls).toHaveLength(2);
  // Hedge should have been used (api2)
  if (result.success) {
    expect(result.usedEndpoint).toBe('https://api2.example.com');
  }
});

// Hedge: with only 1 endpoint, no hedge possible
test('fetchWithRetry does not hedge with single endpoint', async () => {
  const capturedUrls: string[] = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    capturedUrls.push(url);
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  expect(capturedUrls).toHaveLength(1);
});

// Hedge logs when fired
test('fetchWithRetry logs hedge fired and winner', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.startsWith('https://api1.example.com')) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response('slow', { status: 200 })), 2000);
      });
    }
    return Promise.resolve(new Response('fast', { status: 200 }));
  });

  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(consoleSpy).toHaveBeenCalledWith('[ip-rotate]', {
    event: 'hedge-fired',
    attempt: 0,
  });
  expect(consoleSpy).toHaveBeenCalledWith('[ip-rotate]', {
    event: 'hedge-won',
    winner: 'hedge',
    attempt: 0,
  });
  consoleSpy.mockRestore();
});

// Response time recording tests
test('fetchWithRetry records response times on success', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  const counters: Map<string, number> = new Map();
  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });
  const times: readonly number[] = getEndpointResponseTimes(counters, 'example.com', 0);
  expect(times.length).toBe(1);
  expect(times.at(0)).toBeGreaterThanOrEqual(0);
});

test('fetchWithRetry does not record response times on timeout', async () => {
  globalThis.fetch = vi.fn().mockImplementation(() => {
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  });
  const counters: Map<string, number> = new Map();
  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });
  const times: readonly number[] = getEndpointResponseTimes(counters, 'example.com', 0);
  expect(times.length).toBe(0);
});

test('fetchWithRetry uses adaptive hedge delay from recorded response times', async () => {
  const counters: Map<string, number> = new Map();
  // Pre-populate response times: P50 of [50, 100, 150] = 100ms
  // Manually set slot keys for endpoint 0 and 1
  counters.set('rt:example.com:0:0', 50);
  counters.set('rtp:example.com:0', 1);
  counters.set('rt:example.com:1:0', 100);
  counters.set('rtp:example.com:1', 1);
  counters.set('rt:example.com:2:0', 150);
  counters.set('rtp:example.com:2', 1);

  const callTimestamps: number[] = [];
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    callTimestamps.push(Date.now());
    if (url.includes('api1')) {
      // Primary is slow - takes longer than adaptive P50 delay (100ms)
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response('slow', { status: 200 })), 500);
      });
    }
    return Promise.resolve(new Response('fast', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
          { endpoint: 'https://api3.example.com', apiKey: 'key3' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });
  expect(result.success).toBe(true);
  // Hedge should fire after ~100ms (P50) not 500ms (default)
  expect(callTimestamps.length).toBeGreaterThanOrEqual(2);
  const hedgeDelay: number = (callTimestamps.at(1) ?? 0) - (callTimestamps.at(0) ?? 0);
  // Adaptive delay is P50=100ms, allow tolerance
  expect(hedgeDelay).toBeGreaterThanOrEqual(80);
  expect(hedgeDelay).toBeLessThan(300);
});

// parsePositiveIntEnv tests
test('parsePositiveIntEnv returns fallback for undefined', () => {
  expect(parsePositiveIntEnv(undefined, 100)).toBe(100);
});

test('parsePositiveIntEnv returns fallback for empty string', () => {
  expect(parsePositiveIntEnv('', 100)).toBe(100);
});

test('parsePositiveIntEnv returns fallback for non-numeric', () => {
  expect(parsePositiveIntEnv('abc', 100)).toBe(100);
});

test('parsePositiveIntEnv returns fallback for zero', () => {
  expect(parsePositiveIntEnv('0', 100)).toBe(100);
});

test('parsePositiveIntEnv returns fallback for negative', () => {
  expect(parsePositiveIntEnv('-5', 100)).toBe(100);
});

test('parsePositiveIntEnv returns parsed value', () => {
  expect(parsePositiveIntEnv('200', 100)).toBe(200);
});

// resolveTuning tests
test('resolveTuning returns defaults when no env vars', () => {
  const params = {
    config: { endpoints: {}, auth: { type: 'api-key' as const, apiKey: 'key' } },
    targetUrl: new URL('https://example.com'),
    counters: new Map<string, number>(),
    headers: {},
    method: 'GET',
  };
  const tuning = resolveTuning(params);
  expect(tuning.healthTtlMs).toBe(60000);
  expect(tuning.maxHedgeAttempts).toBe(2);
  expect(tuning.hedgeDelayMs).toBe(500);
  expect(tuning.throttleBaseDelayMs).toBe(100);
  expect(tuning.throttleTtlMs).toBe(10000);
  expect(tuning.hedgeSuppressThreshold).toBe(3);
});

test('resolveTuning reads env vars', () => {
  const params = {
    config: { endpoints: {}, auth: { type: 'api-key' as const, apiKey: 'key' } },
    targetUrl: new URL('https://example.com'),
    counters: new Map<string, number>(),
    headers: {},
    method: 'GET',
    envHealthTtlMs: '120000',
    envMaxHedgeAttempts: '4',
    envHedgeDelayMs: '250',
    envThrottleBaseDelayMs: '50',
    envThrottleTtlMs: '20000',
    envHedgeSuppressThreshold: '5',
  };
  const tuning = resolveTuning(params);
  expect(tuning.healthTtlMs).toBe(120000);
  expect(tuning.maxHedgeAttempts).toBe(4);
  expect(tuning.hedgeDelayMs).toBe(250);
  expect(tuning.throttleBaseDelayMs).toBe(50);
  expect(tuning.throttleTtlMs).toBe(20000);
  expect(tuning.hedgeSuppressThreshold).toBe(5);
});

test('resolveTuning falls back on invalid env vars', () => {
  const params = {
    config: { endpoints: {}, auth: { type: 'api-key' as const, apiKey: 'key' } },
    targetUrl: new URL('https://example.com'),
    counters: new Map<string, number>(),
    headers: {},
    method: 'GET',
    envHealthTtlMs: 'invalid',
    envMaxHedgeAttempts: '-1',
  };
  const tuning = resolveTuning(params);
  expect(tuning.healthTtlMs).toBe(60000);
  expect(tuning.maxHedgeAttempts).toBe(2);
});

// calculateThrottleDelay with custom base
test('calculateThrottleDelay with custom base 50 returns 50 for first', () => {
  expect(calculateThrottleDelay(0, 50)).toBe(50);
});

test('calculateThrottleDelay with custom base 50 returns 100 for second', () => {
  expect(calculateThrottleDelay(1, 50)).toBe(100);
});

// Proportional jitter: high consecutive throttles at cap
test('calculateThrottleDelay proportional jitter at cap with random 0.99', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  // base=1000 (capped), jitterRange=floor(1000*0.3)=300, jitter=floor(0.99*300)=297
  expect(calculateThrottleDelay(10)).toBe(1297);
});

// Throttle key tests
test('buildThrottleKey formats correctly', () => {
  expect(buildThrottleKey('example.com', 0)).toBe('429:example.com:0');
  expect(buildThrottleKey('example.com', 3)).toBe('429:example.com:3');
});

test('recordEndpointThrottle records timestamp to counters', () => {
  const counters: Map<string, number> = new Map();
  const before: number = Date.now();
  recordEndpointThrottle({ counters, domain: 'example.com', index: 1 });
  const after: number = Date.now();
  const recorded: number | undefined = counters.get('429:example.com:1');
  expect(recorded).toBeDefined();
  expect(recorded).toBeGreaterThanOrEqual(before);
  expect(recorded).toBeLessThanOrEqual(after);
});

test('getRecentlyThrottledIndices returns recent throttles', () => {
  const counters: Map<string, number> = new Map();
  counters.set('429:example.com:0', Date.now());
  counters.set('429:example.com:2', Date.now());
  const result: Set<number> = getRecentlyThrottledIndices({
    counters,
    domain: 'example.com',
    endpointCount: 3,
  });
  expect(result.has(0)).toBe(true);
  expect(result.has(1)).toBe(false);
  expect(result.has(2)).toBe(true);
});

test('getRecentlyThrottledIndices excludes expired throttles', () => {
  const counters: Map<string, number> = new Map();
  counters.set('429:example.com:0', Date.now() - 20000);
  const result: Set<number> = getRecentlyThrottledIndices({
    counters,
    domain: 'example.com',
    endpointCount: 2,
  });
  expect(result.has(0)).toBe(false);
  expect(result.has(1)).toBe(false);
});

test('getRecentlyThrottledIndices respects custom TTL', () => {
  const counters: Map<string, number> = new Map();
  counters.set('429:example.com:0', Date.now() - 5000);
  const resultDefault: Set<number> = getRecentlyThrottledIndices({
    counters,
    domain: 'example.com',
    endpointCount: 1,
  });
  expect(resultDefault.has(0)).toBe(true);
  const resultShortTtl: Set<number> = getRecentlyThrottledIndices({
    counters,
    domain: 'example.com',
    endpointCount: 1,
    throttleTtlMs: 3000,
  });
  expect(resultShortTtl.has(0)).toBe(false);
});

// fetchWithRetry records 429 to counters
test('fetchWithRetry records 429 throttle to counters', async () => {
  let callCount: number = 0;
  const counters: Map<string, number> = new Map();

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters,
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  // 429 should have been recorded for the throttled endpoint
  expect(counters.has('429:example.com:0')).toBe(true);
  // EWMA should also reflect throttle penalty
  expect(counters.has('ewma:example.com:0')).toBe(true);
});

test('fetchWithRetry logs endpoint-throttled on 429', async () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  let callCount: number = 0;

  globalThis.fetch = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
    }
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(consoleSpy).toHaveBeenCalledWith('[ip-rotate]', {
    event: 'endpoint-throttled',
    domain: 'example.com',
    index: 0,
    endpoint: 'https://api1.example.com',
  });
  consoleSpy.mockRestore();
});

// ACCEPT_ENCODING_IDENTITY constant
test('ACCEPT_ENCODING_IDENTITY is identity', () => {
  expect(ACCEPT_ENCODING_IDENTITY).toBe('identity');
});

// stripCompressionEncoding tests
test('stripCompressionEncoding overrides accept-encoding to identity', () => {
  const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate, br' };
  const result: Record<string, string> = stripCompressionEncoding(headers);
  expect(result['accept-encoding']).toBe('identity');
});

test('stripCompressionEncoding adds accept-encoding when missing', () => {
  const headers: Record<string, string> = { 'content-type': 'text/html' };
  const result: Record<string, string> = stripCompressionEncoding(headers);
  expect(result['accept-encoding']).toBe('identity');
  expect(result['content-type']).toBe('text/html');
});

test('stripCompressionEncoding preserves other headers', () => {
  const headers: Record<string, string> = {
    'accept-encoding': 'gzip',
    'user-agent': 'test',
    'x-custom': 'value',
  };
  const result: Record<string, string> = stripCompressionEncoding(headers);
  expect(result['accept-encoding']).toBe('identity');
  expect(result['user-agent']).toBe('test');
  expect(result['x-custom']).toBe('value');
});

// fetchWithApiKey sets accept-encoding: identity
test('fetchWithAuth api-key sets accept-encoding to identity', async () => {
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'api-key', apiKey: 'test-key' },
    headers: { 'accept-encoding': 'gzip, deflate, br' },
    method: 'GET',
  });

  expect(capturedHeaders['accept-encoding']).toBe('identity');
});

// fetchWithIam sets accept-encoding: identity
test('fetchWithAuth iam sets accept-encoding to identity', async () => {
  let capturedHeaders: Record<string, string> = {};

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'iam', accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' },
    headers: { 'accept-encoding': 'gzip, deflate, br' },
    method: 'GET',
  });

  expect(capturedHeaders['accept-encoding']).toBe('identity');
});

// fetchWithApiKey sets redirect: manual
test('fetchWithAuth api-key sets redirect to manual', async () => {
  let capturedRedirect: RequestRedirect | undefined;

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedRedirect = init?.redirect;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'api-key', apiKey: 'test-key' },
    headers: {},
    method: 'GET',
  });

  expect(capturedRedirect).toBe('manual');
});

// fetchWithApiKey sets cache: no-store
test('fetchWithAuth api-key sets cache to no-store', async () => {
  let capturedCache: RequestCache | undefined;

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedCache = init?.cache;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'api-key', apiKey: 'test-key' },
    headers: {},
    method: 'GET',
  });

  expect(capturedCache).toBe('no-store');
});

// fetchWithIam sets redirect: manual
test('fetchWithAuth iam sets redirect to manual', async () => {
  let capturedRedirect: RequestRedirect | undefined;

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedRedirect = init?.redirect;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'iam', accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' },
    headers: {},
    method: 'GET',
  });

  expect(capturedRedirect).toBe('manual');
});

// fetchWithIam sets cache: no-store
test('fetchWithAuth iam sets cache to no-store', async () => {
  let capturedCache: RequestCache | undefined;

  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    capturedCache = init?.cache;
    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  await fetchWithAuth({
    url: new URL('https://example.com'),
    auth: { type: 'iam', accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' },
    headers: {},
    method: 'GET',
  });

  expect(capturedCache).toBe('no-store');
});

// 302 response returned as-is (not followed)
test('fetchWithRetry returns 302 as success without following redirect', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(Response.redirect('https://other.com', 302));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.response.status).toBe(302);
  }
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

// 533 worker resource exhausted - not retried, returned as success immediately
test('fetchWithRetry returns 533 as success without retry', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('Resource Exhausted', { status: 533 }));

  const result = await fetchWithRetry({
    config: {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'key' },
    },
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.response.status).toBe(533);
  }
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

// calculateMaxRetries capping with ABSOLUTE_MAX_RETRIES
test('calculateMaxRetries for 20 endpoints returns 20', () => {
  expect(calculateMaxRetries(20)).toBe(20);
});

test('calculateMaxRetries for 15 endpoints returns 15', () => {
  expect(calculateMaxRetries(15)).toBe(15);
});

// drainResponseBody tests
test('drainResponseBody calls body.cancel() on resolved response', async () => {
  const cancelMock = vi.fn().mockResolvedValue(undefined);
  const mockBody = { cancel: cancelMock } as unknown as ReadableStream<Uint8Array>;
  const promise: Promise<{ response: Response | null; timedOut: boolean; usedEndpoint: string }> =
    Promise.resolve({
      response: { body: mockBody } as unknown as Response,
      timedOut: false,
      usedEndpoint: 'https://example.com',
    });
  drainResponseBody(promise);
  await promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelMock).toHaveBeenCalledTimes(1);
});

test('drainResponseBody handles null response without throwing', async () => {
  const promise: Promise<{ response: Response | null; timedOut: boolean; usedEndpoint: string }> =
    Promise.resolve({
      response: null,
      timedOut: true,
      usedEndpoint: 'https://example.com',
    });
  drainResponseBody(promise);
  await promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('drainResponseBody handles response with null body without throwing', async () => {
  const promise: Promise<{ response: Response | null; timedOut: boolean; usedEndpoint: string }> =
    Promise.resolve({
      response: { body: null } as unknown as Response,
      timedOut: false,
      usedEndpoint: 'https://example.com',
    });
  drainResponseBody(promise);
  await promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('drainResponseBody handles rejected promise without throwing', async () => {
  const promise: Promise<{ response: Response | null; timedOut: boolean; usedEndpoint: string }> =
    Promise.reject(new Error('fetch failed'));
  drainResponseBody(promise);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
