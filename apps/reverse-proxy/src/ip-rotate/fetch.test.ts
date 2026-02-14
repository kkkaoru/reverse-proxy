// IP Rotation fetch tests
// Execute with bun: bun test

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  adjustTimeoutOnFailure,
  adjustTimeoutOnSuccess,
  calculateMaxRetries,
  clampTimeout,
  DEFAULT_TIMEOUT_MS,
  defaultTimeoutConfig,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  ERROR_WALL_CLOCK_TIMEOUT,
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  isErrorStatus,
  isTimeoutError,
  MAX_TIMEOUT_MS,
  MIN_RETRIES,
  MIN_TIMEOUT_MS,
  parseEnvTimeout,
  STATUS_ERROR_THRESHOLD,
  TIMEOUT_ADJUSTMENT_MS,
} from './fetch.ts';

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

test('STATUS_ERROR_THRESHOLD is 400', () => {
  expect(STATUS_ERROR_THRESHOLD).toBe(400);
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

test('TIMEOUT_ADJUSTMENT_MS is 500', () => {
  expect(TIMEOUT_ADJUSTMENT_MS).toBe(500);
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

test('defaultTimeoutConfig adjustmentMs', () => {
  expect(defaultTimeoutConfig.adjustmentMs).toBe(500);
});

test('isErrorStatus true for 400', () => {
  expect(isErrorStatus(400)).toBe(true);
});

test('isErrorStatus true for 500', () => {
  expect(isErrorStatus(500)).toBe(true);
});

test('isErrorStatus false for 200', () => {
  expect(isErrorStatus(200)).toBe(false);
});

test('isErrorStatus false for 399', () => {
  expect(isErrorStatus(399)).toBe(false);
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

test('calculateMaxRetries for 51 endpoints returns 51', () => {
  expect(calculateMaxRetries(51)).toBe(51);
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

test('adjustTimeoutOnSuccess normal', () => {
  expect(adjustTimeoutOnSuccess(5000, defaultTimeoutConfig)).toBe(4500);
});

test('adjustTimeoutOnSuccess clamp to min', () => {
  expect(adjustTimeoutOnSuccess(2200, defaultTimeoutConfig)).toBe(2000);
});

test('adjustTimeoutOnSuccess at min', () => {
  expect(adjustTimeoutOnSuccess(2000, defaultTimeoutConfig)).toBe(2000);
});

test('adjustTimeoutOnFailure normal', () => {
  expect(adjustTimeoutOnFailure(5000, defaultTimeoutConfig)).toBe(5500);
});

test('adjustTimeoutOnFailure clamp to max', () => {
  expect(adjustTimeoutOnFailure(7800, defaultTimeoutConfig)).toBe(8000);
});

test('adjustTimeoutOnFailure at max', () => {
  expect(adjustTimeoutOnFailure(8000, defaultTimeoutConfig)).toBe(8000);
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

test('fetchWithRetry retries on error status', async () => {
  let callCount = 0;

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

test('fetchWithRetry max retries', async () => {
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
  }
});

test('fetchWithRetry handles timeout', async () => {
  let callCount = 0;

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
    // Return error to trigger retry
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

  // Should have tried max(3, 5) = 5 retries
  expect(capturedApiKeys.length).toBe(5);

  // Verify endpoint-specific keys are used, not the base key
  expect(capturedApiKeys).not.toContain('base-key-should-not-be-used');

  // Verify round-robin pattern uses correct endpoint-specific keys
  expect(capturedApiKeys[0]).toBe('endpoint-key-1');
  expect(capturedApiKeys[1]).toBe('endpoint-key-2');
  expect(capturedApiKeys[2]).toBe('endpoint-key-3');
  expect(capturedApiKeys[3]).toBe('endpoint-key-1');
  expect(capturedApiKeys[4]).toBe('endpoint-key-2');
});

test('fetchWithRetry correctly matches URL and API key on each request', async () => {
  const capturedRequests: Array<{ url: string; apiKey: string }> = [];

  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const apiKey = headers?.['x-api-key'] ?? '';
    capturedRequests.push({ url, apiKey });
    // Return error to trigger retry
    return Promise.resolve(new Response('error', { status: 498 }));
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

  // Should have tried 5 times (max(2, 5) = 5)
  expect(capturedRequests.length).toBe(5);

  // Verify each URL is matched with the correct API key
  for (const req of capturedRequests) {
    if (req.url.includes('gateway-1')) {
      expect(req.apiKey).toBe('key-for-gateway-1');
    } else if (req.url.includes('gateway-2')) {
      expect(req.apiKey).toBe('key-for-gateway-2');
    }
  }

  // Verify round-robin order
  expect(capturedRequests[0]?.url).toContain('gateway-1');
  expect(capturedRequests[0]?.apiKey).toBe('key-for-gateway-1');
  expect(capturedRequests[1]?.url).toContain('gateway-2');
  expect(capturedRequests[1]?.apiKey).toBe('key-for-gateway-2');
  expect(capturedRequests[2]?.url).toContain('gateway-1');
  expect(capturedRequests[2]?.apiKey).toBe('key-for-gateway-1');
  expect(capturedRequests[3]?.url).toContain('gateway-2');
  expect(capturedRequests[3]?.apiKey).toBe('key-for-gateway-2');
  expect(capturedRequests[4]?.url).toContain('gateway-1');
  expect(capturedRequests[4]?.apiKey).toBe('key-for-gateway-1');
});

test('fetchWithRetry returns lastUsedEndpoint on failure', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 498 }));

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
    expect(result.lastResponse?.status).toBe(498);
    // lastUsedEndpoint should be set to the last endpoint that was tried
    expect(result.lastUsedEndpoint).not.toBeNull();
    expect(result.lastUsedEndpoint).toContain('gateway-');
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
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('fetchWithRetry stops retries mid-loop when wallClockSignal aborts', async () => {
  let callCount = 0;
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
  }
  // Should have stopped after 2 calls, not retried all 5
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
