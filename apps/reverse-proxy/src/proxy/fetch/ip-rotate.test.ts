// Tests for IP rotation fetch operations
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FetchRetryResult } from '../../ip-rotate/types.ts';
import type { IpRotateFetchParams, ProxyCacheOptions } from '../types.ts';

vi.mock('../../ip-rotate/fetch.ts', () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock('../../ip-rotate/health-sync.ts', () => ({
  reportOutcomeToDO: vi.fn(),
}));

vi.mock('../../ip-rotate/client.ts', () => ({
  isIpRotateTarget: vi.fn(),
}));

vi.mock('../cache.ts', () => ({
  logEvent: vi.fn(),
}));

import { fetchWithRetry } from '../../ip-rotate/fetch.ts';
import { reportOutcomeToDO } from '../../ip-rotate/health-sync.ts';
import { fetchViaIpRotate, performIpRotateFetch, shouldUseIpRotate } from './ip-rotate.ts';

const mockFetchWithRetry: ReturnType<typeof vi.fn> = fetchWithRetry as ReturnType<typeof vi.fn>;
const mockReportOutcomeToDO: ReturnType<typeof vi.fn> = reportOutcomeToDO as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- fetchViaIpRotate tests ---

test('fetchViaIpRotate returns response and usedEndpoint on success', async () => {
  const successResponse: Response = new Response('ok', { status: 200 });
  const successResult: FetchRetryResult = {
    success: true,
    response: successResponse,
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const params: IpRotateFetchParams = {
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
    config: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    counters: new Map<string, number>(),
  };

  const result = await fetchViaIpRotate(params);

  expect(result).not.toBeNull();
  expect(result?.response).toBe(successResponse);
  expect(result?.usedEndpoint).toBe('https://ep1.example.com');
});

test('fetchViaIpRotate returns lastResponse when failure has lastResponse', async () => {
  const lastResponse: Response = new Response('error', { status: 503 });
  const failureResult: FetchRetryResult = {
    success: false,
    lastResponse,
    lastUsedEndpoint: 'https://ep1.example.com',
    error: 'MAX_RETRIES',
    errorCode: 'MAX_RETRIES',
    totalAttempts: 3,
  };
  mockFetchWithRetry.mockResolvedValueOnce(failureResult);

  const params: IpRotateFetchParams = {
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
    config: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    counters: new Map<string, number>(),
  };

  const result = await fetchViaIpRotate(params);

  expect(result).not.toBeNull();
  expect(result?.response).toBe(lastResponse);
  expect(result?.usedEndpoint).toBe('https://ep1.example.com');
});

test('fetchViaIpRotate returns null when failure has no lastResponse', async () => {
  const failureResult: FetchRetryResult = {
    success: false,
    lastResponse: null,
    lastUsedEndpoint: null,
    error: 'NO_ENDPOINTS',
    errorCode: 'NO_ENDPOINTS',
    totalAttempts: 0,
  };
  mockFetchWithRetry.mockResolvedValueOnce(failureResult);

  const params: IpRotateFetchParams = {
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
    config: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    counters: new Map<string, number>(),
  };

  const result = await fetchViaIpRotate(params);

  expect(result).toBeNull();
});

test('fetchViaIpRotate returns empty string usedEndpoint when lastUsedEndpoint is null', async () => {
  const lastResponse: Response = new Response('error', { status: 500 });
  const failureResult: FetchRetryResult = {
    success: false,
    lastResponse,
    lastUsedEndpoint: null,
    error: 'WALL_CLOCK_TIMEOUT',
    errorCode: 'WALL_CLOCK_TIMEOUT',
    totalAttempts: 2,
  };
  mockFetchWithRetry.mockResolvedValueOnce(failureResult);

  const params: IpRotateFetchParams = {
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
    config: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    counters: new Map<string, number>(),
  };

  const result = await fetchViaIpRotate(params);

  expect(result).not.toBeNull();
  expect(result?.usedEndpoint).toBe('');
});

test('fetchViaIpRotate passes tuningEnv to fetchWithRetry', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok'),
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const params: IpRotateFetchParams = {
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
    config: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    counters: new Map<string, number>(),
    tuningEnv: { envDefaultTimeoutMs: '5000' },
  };

  await fetchViaIpRotate(params);

  expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
  const callArgs: Record<string, unknown> = mockFetchWithRetry.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;
  expect(callArgs.envDefaultTimeoutMs).toBe('5000');
  expect(callArgs.method).toBe('GET');
});

// --- onEndpointOutcome reporting (tested indirectly via performIpRotateFetch) ---

test('performIpRotateFetch passes onEndpointOutcome to fetchWithRetry that reports success with actual endpoint index to DO', async () => {
  const successResponse: Response = new Response('ok', { status: 200 });
  const successResult: FetchRetryResult = {
    success: true,
    response: successResponse,
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);
  mockReportOutcomeToDO.mockResolvedValueOnce(undefined);

  const mockWaitUntil: ReturnType<typeof vi.fn> = vi.fn();
  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
    healthCoordinator: {} as DurableObjectNamespace,
    executionCtx: {
      waitUntil: mockWaitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  const callArgs: Record<string, unknown> = mockFetchWithRetry.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;
  const onOutcome = callArgs.onEndpointOutcome as (outcome: Record<string, unknown>) => void;
  expect(typeof onOutcome).toBe('function');

  onOutcome({
    index: 2,
    endpoint: 'https://ep3.example.com',
    status: 200,
    isSuccess: true,
    isThrottle: false,
    isServerError: false,
  });

  expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  expect(mockReportOutcomeToDO).toHaveBeenCalledWith({
    healthCoordinator: options.healthCoordinator,
    domain: 'target.example.com',
    index: 2,
    isSuccess: true,
    isThrottle: false,
    isServerError: false,
  });
});

test('performIpRotateFetch reports throttle (429) via onEndpointOutcome with actual endpoint index', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok', { status: 200 }),
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);
  mockReportOutcomeToDO.mockResolvedValueOnce(undefined);

  const mockWaitUntil: ReturnType<typeof vi.fn> = vi.fn();
  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
    healthCoordinator: {} as DurableObjectNamespace,
    executionCtx: {
      waitUntil: mockWaitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  const callArgs: Record<string, unknown> = mockFetchWithRetry.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;
  const onOutcome = callArgs.onEndpointOutcome as (outcome: Record<string, unknown>) => void;
  onOutcome({
    index: 1,
    endpoint: 'https://ep2.example.com',
    status: 429,
    isSuccess: false,
    isThrottle: true,
    isServerError: false,
  });

  expect(mockReportOutcomeToDO).toHaveBeenCalledWith({
    healthCoordinator: options.healthCoordinator,
    domain: 'target.example.com',
    index: 1,
    isSuccess: false,
    isThrottle: true,
    isServerError: false,
  });
});

test('performIpRotateFetch reports 5xx server error via onEndpointOutcome with actual endpoint index', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok', { status: 200 }),
    usedEndpoint: 'https://ep3.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);
  mockReportOutcomeToDO.mockResolvedValueOnce(undefined);

  const mockWaitUntil: ReturnType<typeof vi.fn> = vi.fn();
  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
    healthCoordinator: {} as DurableObjectNamespace,
    executionCtx: {
      waitUntil: mockWaitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  const callArgs: Record<string, unknown> = mockFetchWithRetry.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;
  const onOutcome = callArgs.onEndpointOutcome as (outcome: Record<string, unknown>) => void;
  onOutcome({
    index: 3,
    endpoint: 'https://ep4.example.com',
    status: 652,
    isSuccess: false,
    isThrottle: false,
    isServerError: true,
  });

  expect(mockReportOutcomeToDO).toHaveBeenCalledWith({
    healthCoordinator: options.healthCoordinator,
    domain: 'target.example.com',
    index: 3,
    isSuccess: false,
    isThrottle: false,
    isServerError: true,
  });
});

test('performIpRotateFetch onEndpointOutcome callback is absent when healthCoordinator missing', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok', { status: 200 }),
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  const callArgs: Record<string, unknown> = mockFetchWithRetry.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;
  expect(callArgs.onEndpointOutcome).toBeUndefined();
});

test('performIpRotateFetch skips reportOutcome when healthCoordinator is missing', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok', { status: 200 }),
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(mockReportOutcomeToDO).not.toHaveBeenCalled();
});

test('performIpRotateFetch skips reportOutcome when executionCtx is missing', async () => {
  const successResult: FetchRetryResult = {
    success: true,
    response: new Response('ok', { status: 200 }),
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
    healthCoordinator: {} as DurableObjectNamespace,
  };

  await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(mockReportOutcomeToDO).not.toHaveBeenCalled();
});

// --- shouldUseIpRotate tests ---

test('shouldUseIpRotate returns false when ipRotateConfig is missing', () => {
  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateCounters: new Map<string, number>(),
  };

  expect(shouldUseIpRotate(options, new URL('https://example.com'))).toBe(false);
});

// --- performIpRotateFetch tests ---

test('performIpRotateFetch returns null when ipRotateConfig is missing', async () => {
  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateCounters: new Map<string, number>(),
  };

  const result: Response | null = await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(result).toBeNull();
  expect(mockFetchWithRetry).not.toHaveBeenCalled();
});

test('performIpRotateFetch returns lastResponse on failure', async () => {
  const lastResponse: Response = new Response('bad', { status: 502 });
  const failureResult: FetchRetryResult = {
    success: false,
    lastResponse,
    lastUsedEndpoint: 'https://ep1.example.com',
    error: 'MAX_RETRIES',
    errorCode: 'MAX_RETRIES',
    totalAttempts: 3,
  };
  mockFetchWithRetry.mockResolvedValueOnce(failureResult);

  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
  };

  const result: Response | null = await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(result).toBe(lastResponse);
});

test('performIpRotateFetch returns null on failure with no lastResponse', async () => {
  const failureResult: FetchRetryResult = {
    success: false,
    lastResponse: null,
    lastUsedEndpoint: null,
    error: 'NO_ENDPOINTS',
    errorCode: 'NO_ENDPOINTS',
    totalAttempts: 0,
  };
  mockFetchWithRetry.mockResolvedValueOnce(failureResult);

  const options: ProxyCacheOptions = {
    enableLogging: false,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
  };

  const result: Response | null = await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(result).toBeNull();
});

test('performIpRotateFetch returns response on success', async () => {
  const successResponse: Response = new Response('ok', { status: 200 });
  const successResult: FetchRetryResult = {
    success: true,
    response: successResponse,
    usedEndpoint: 'https://ep1.example.com',
  };
  mockFetchWithRetry.mockResolvedValueOnce(successResult);

  const options: ProxyCacheOptions = {
    enableLogging: true,
    enableCacheApi: false,
    cacheVersion: 'v1',
    ipRotateConfig: {
      endpoints: {
        'target.example.com': [{ endpoint: 'https://ep1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key', apiKey: 'key1' },
    },
    ipRotateCounters: new Map<string, number>(),
  };

  const result: Response | null = await performIpRotateFetch({
    options,
    url: new URL('https://target.example.com/page'),
    headers: { 'user-agent': 'test' },
  });

  expect(result).toBe(successResponse);
});
