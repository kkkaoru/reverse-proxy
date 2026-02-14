// IP Rotation fetch tests
// Execute with bun: bun test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  calculateMaxRetries,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  isErrorStatus,
  isRetriableError,
  STATUS_ERROR_THRESHOLD,
} from '../src/ip-rotate/fetch.ts';
import type {
  FetchWithAuthParams,
  FetchWithRetryParams,
  IpRotateAuth,
  IpRotateConfig,
} from '../src/ip-rotate/types.ts';

const createApiKeyAuth = (): IpRotateAuth => ({
  type: 'api-key',
  apiKey: 'test-api-key-12345',
});

const createIamAuth = (): IpRotateAuth => ({
  type: 'iam',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
});

type FetchFn = typeof globalThis.fetch;

describe('ip-rotate-fetch', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchWithAuth with API Key', () => {
    test('should include x-api-key header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: { 'user-agent': 'test-agent' },
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.['x-api-key']).toBe('test-api-key-12345');
    });

    test('should preserve original headers', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: { 'user-agent': 'test-agent', accept: 'application/json' },
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.['user-agent']).toBe('test-agent');
      expect(capturedHeaders?.accept).toBe('application/json');
    });

    test('should call fetch with correct URL', async () => {
      let capturedUrl: string | undefined;
      globalThis.fetch = vi.fn().mockImplementation((url: unknown) => {
        capturedUrl = String(url);
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedUrl).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
    });

    test('should use correct HTTP method', async () => {
      let capturedMethod: string | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedMethod = init?.method;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'POST',
      };

      await fetchWithAuth(params);

      expect(capturedMethod).toBe('POST');
    });

    test('should return response from fetch', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response('success body', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'GET',
      };

      const response = await fetchWithAuth(params);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('success body');
    });
  });

  describe('fetchWithAuth with IAM', () => {
    test('should include authorization header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.authorization).toBeDefined();
      expect(capturedHeaders?.authorization?.startsWith('AWS4-HMAC-SHA256')).toBe(true);
    });

    test('should include x-amz-date header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.['x-amz-date']).toBeDefined();
    });

    test('should include host header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.host).toBe('abc123.execute-api.us-east-1.amazonaws.com');
    });
  });

  describe('fetchWithAuth error handling', () => {
    test('should throw error for unsupported auth type', async () => {
      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: { type: 'unknown' } as unknown as IpRotateAuth,
        headers: {},
        method: 'GET',
      };

      await expect(fetchWithAuth(params)).rejects.toThrow('Unsupported auth type: unknown');
    });
  });
});

describe('ip-rotate-fetch retry logic', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('isErrorStatus returns true for status >= 400', () => {
    expect(isErrorStatus(400)).toBe(true);
    expect(isErrorStatus(404)).toBe(true);
    expect(isErrorStatus(500)).toBe(true);
    expect(isErrorStatus(STATUS_ERROR_THRESHOLD)).toBe(true);
  });

  test('isErrorStatus returns false for status < 400', () => {
    expect(isErrorStatus(200)).toBe(false);
    expect(isErrorStatus(301)).toBe(false);
    expect(isErrorStatus(399)).toBe(false);
  });

  test('calculateMaxRetries returns max of endpoint count and MIN_RETRIES', () => {
    expect(calculateMaxRetries(3)).toBe(5);
    expect(calculateMaxRetries(1)).toBe(5);
    expect(calculateMaxRetries(5)).toBe(5);
    expect(calculateMaxRetries(10)).toBe(10);
  });

  test('fetchWithRetry returns success on first successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.status).toBe(200);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('fetchWithRetry retries on 4xx error and succeeds', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response('error', { status: 404 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.status).toBe(200);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('fetchWithRetry retries on 5xx error and succeeds', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(new Response('error', { status: 500 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response.status).toBe(200);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('fetchWithRetry fails after max retries (2 loops)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500 }));

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(ERROR_ALL_ENDPOINTS_FAILED);
      expect(result.lastResponse?.status).toBe(500);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });

  test('fetchWithRetry returns failure when no endpoints available', async () => {
    const config: IpRotateConfig = {
      endpoints: {
        'other.com': [{ endpoint: 'https://api1.other.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(ERROR_NO_ENDPOINTS_AVAILABLE);
    }
  });

  test('fetchWithRetry uses round-robin across endpoints', async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      return Promise.resolve(new Response('error', { status: 500 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    await fetchWithRetry(params);

    expect(capturedUrls).toHaveLength(5);
    expect(capturedUrls[0]).toBe('https://api1.example.com/path');
    expect(capturedUrls[1]).toBe('https://api2.example.com/path');
    expect(capturedUrls[2]).toBe('https://api1.example.com/path');
    expect(capturedUrls[3]).toBe('https://api2.example.com/path');
    expect(capturedUrls[4]).toBe('https://api1.example.com/path');
  });

  test('fetchWithRetry uses endpoint-specific API key', async () => {
    const capturedHeaders: Record<string, string>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders.push(init?.headers as Record<string, string>);
      return Promise.resolve(new Response('error', { status: 500 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'endpoint-key-1' },
          { endpoint: 'https://api2.example.com', apiKey: 'endpoint-key-2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'base-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    await fetchWithRetry(params);

    expect(capturedHeaders).toHaveLength(5);
    expect(capturedHeaders[0]?.['x-api-key']).toBe('endpoint-key-1');
    expect(capturedHeaders[1]?.['x-api-key']).toBe('endpoint-key-2');
    expect(capturedHeaders[2]?.['x-api-key']).toBe('endpoint-key-1');
    expect(capturedHeaders[3]?.['x-api-key']).toBe('endpoint-key-2');
    expect(capturedHeaders[4]?.['x-api-key']).toBe('endpoint-key-1');
  });
});

describe('isRetriableError', () => {
  test('isRetriableError returns true for TimeoutError', () => {
    const error: Error = new Error('The operation timed out');
    error.name = 'TimeoutError';
    expect(isRetriableError(error)).toBe(true);
  });

  test('isRetriableError returns true for AbortError with timeout message', () => {
    const error: Error = new Error('The operation was aborted due to timeout');
    error.name = 'AbortError';
    expect(isRetriableError(error)).toBe(true);
  });

  test('isRetriableError returns false for AbortError without timeout message', () => {
    const error: Error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(isRetriableError(error)).toBe(false);
  });

  test('isRetriableError returns true for TypeError', () => {
    const error: TypeError = new TypeError('fetch failed');
    expect(isRetriableError(error)).toBe(true);
  });

  test('isRetriableError returns false for generic Error', () => {
    const error: Error = new Error('Something went wrong');
    expect(isRetriableError(error)).toBe(false);
  });

  test('isRetriableError returns false for non-Error values', () => {
    expect(isRetriableError('string error')).toBe(false);
    expect(isRetriableError(null)).toBe(false);
    expect(isRetriableError(undefined)).toBe(false);
  });
});

describe('ip-rotate-fetch retriable error retry', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('fetchWithRetry retries on TypeError (network error) and succeeds', async () => {
    const capturedUrls: string[] = [];
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(true);
    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).toBe('https://api1.example.com/path');
    expect(capturedUrls[1]).toBe('https://api2.example.com/path');
  });

  test('fetchWithRetry retries on AbortError with timeout message and succeeds', async () => {
    const capturedUrls: string[] = [];
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      callCount++;
      if (callCount === 1) {
        const error: Error = new Error('The operation was aborted due to timeout');
        error.name = 'AbortError';
        return Promise.reject(error);
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    const result = await fetchWithRetry(params);

    expect(result.success).toBe(true);
    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).toBe('https://api1.example.com/path');
    expect(capturedUrls[1]).toBe('https://api2.example.com/path');
  });

  test('fetchWithRetry throws non-retriable errors immediately', async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error('Invalid auth type')));

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    await expect(fetchWithRetry(params)).rejects.toThrow('Invalid auth type');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('fetchWithRetry logs retry attempts on timeout', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error: Error = new Error('The operation timed out');
        error.name = 'TimeoutError';
        return Promise.reject(error);
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    await fetchWithRetry(params);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[ip-rotate] retry attempt=0 endpoint=https://api1.example.com reason=timeout',
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[ip-rotate] success attempt=1 endpoint=https://api2.example.com',
    );
    consoleSpy.mockRestore();
  });

  test('fetchWithRetry logs retry attempts on error status', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response('error', { status: 500 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const config: IpRotateConfig = {
      endpoints: {
        'example.com': [
          { endpoint: 'https://api1.example.com', apiKey: 'key1' },
          { endpoint: 'https://api2.example.com', apiKey: 'key2' },
        ],
      },
      auth: { type: 'api-key', apiKey: 'test-key' },
    };

    const params: FetchWithRetryParams = {
      config,
      targetUrl: new URL('https://example.com/path'),
      counters: new Map(),
      headers: {},
      method: 'GET',
    };

    await fetchWithRetry(params);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[ip-rotate] retry attempt=0 endpoint=https://api1.example.com reason=error-status',
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[ip-rotate] success attempt=1 endpoint=https://api2.example.com',
    );
    consoleSpy.mockRestore();
  });
});

test('getDefaultTimeoutFromEnv returns parsed value for valid string', () => {
  expect(getDefaultTimeoutFromEnv('3000')).toBe(3000);
});

test('getDefaultTimeoutFromEnv returns default for undefined', () => {
  expect(getDefaultTimeoutFromEnv(undefined)).toBe(2000);
});

test('getDefaultTimeoutFromEnv returns default for invalid string', () => {
  expect(getDefaultTimeoutFromEnv('abc')).toBe(2000);
});

test('getDefaultTimeoutFromEnv returns default for empty string', () => {
  expect(getDefaultTimeoutFromEnv('')).toBe(2000);
});

test('fetchWithRetry uses envDefaultTimeoutMs when provided', async () => {
  const originalFetch: typeof globalThis.fetch = globalThis.fetch;
  vi.spyOn(Math, 'random').mockReturnValue(0);

  let capturedSignal: AbortSignal | null | undefined;
  globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
    capturedSignal = init?.signal;
    return Promise.resolve(new Response('ok', { status: 200 }));
  }) as unknown as typeof globalThis.fetch;

  const config: IpRotateConfig = {
    endpoints: {
      'example.com': [
        { endpoint: 'https://api1.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      ],
    },
    auth: { type: 'api-key', apiKey: 'test-key' },
  };

  const params: FetchWithRetryParams = {
    config,
    targetUrl: new URL('https://example.com/path'),
    counters: new Map(),
    headers: {},
    method: 'GET',
    envDefaultTimeoutMs: '5000',
  };

  const result = await fetchWithRetry(params);

  expect(result.success).toBe(true);
  expect(capturedSignal).toBeDefined();

  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
