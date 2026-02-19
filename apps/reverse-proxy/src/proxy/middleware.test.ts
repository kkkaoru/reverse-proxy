// Proxy middleware cache TTL tests
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { IpRotateConfig } from '../ip-rotate/types.ts';
import {
  type CachedConfigEntry,
  CONFIG_CACHE_TTL_MS,
  getExecutionCtx,
  getOrLoadIpRotateConfig,
  isCacheValid,
  type SyncHealthFromDoParams,
  syncHealthFromDo,
} from './middleware.ts';

const MOCK_CONFIG: IpRotateConfig = {
  endpoints: {
    'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
  },
  auth: { type: 'api-key', apiKey: 'key1' },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('CONFIG_CACHE_TTL_MS is 300000', () => {
  expect(CONFIG_CACHE_TTL_MS).toBe(300000);
});

test('isCacheValid returns false for undefined', () => {
  expect(isCacheValid(undefined)).toBe(false);
});

test('isCacheValid returns true for fresh entry', () => {
  const entry: CachedConfigEntry = { config: MOCK_CONFIG, cachedAt: Date.now() };
  expect(isCacheValid(entry)).toBe(true);
});

test('isCacheValid returns true for entry within TTL', () => {
  const entry: CachedConfigEntry = { config: MOCK_CONFIG, cachedAt: Date.now() - 299999 };
  expect(isCacheValid(entry)).toBe(true);
});

test('isCacheValid returns false for expired entry', () => {
  const entry: CachedConfigEntry = { config: MOCK_CONFIG, cachedAt: Date.now() - 300001 };
  expect(isCacheValid(entry)).toBe(false);
});

test('isCacheValid returns false for exactly TTL boundary', () => {
  const entry: CachedConfigEntry = { config: MOCK_CONFIG, cachedAt: Date.now() - 300000 };
  expect(isCacheValid(entry)).toBe(false);
});

test('getOrLoadIpRotateConfig returns cached config within TTL', async () => {
  const cache: Map<string, CachedConfigEntry> = new Map();
  cache.set('default', { config: MOCK_CONFIG, cachedAt: Date.now() });

  const env = {} as Parameters<typeof getOrLoadIpRotateConfig>[0];
  const result: IpRotateConfig | undefined = await getOrLoadIpRotateConfig(env, cache);

  expect(result).toBe(MOCK_CONFIG);
});

test('getOrLoadIpRotateConfig reloads after TTL expires', async () => {
  const cache: Map<string, CachedConfigEntry> = new Map();
  cache.set('default', { config: MOCK_CONFIG, cachedAt: Date.now() - 300001 });

  const env = {
    IP_ROTATE_ENDPOINTS: JSON.stringify({
      'new.example.com': [{ endpoint: 'https://new-api.example.com', apiKey: 'new-key' }],
    }),
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'new-key',
  } as Parameters<typeof getOrLoadIpRotateConfig>[0];

  const result: IpRotateConfig | undefined = await getOrLoadIpRotateConfig(env, cache);

  expect(result).toBeDefined();
  expect(result?.endpoints['new.example.com']).toBeDefined();
});

test('getOrLoadIpRotateConfig stores timestamp on cache miss', async () => {
  const cache: Map<string, CachedConfigEntry> = new Map();

  const env = {
    IP_ROTATE_ENDPOINTS: JSON.stringify({
      'example.com': [{ endpoint: 'https://api.example.com', apiKey: 'key1' }],
    }),
    IP_ROTATE_AUTH_TYPE: 'api-key',
    IP_ROTATE_API_KEY: 'key1',
  } as Parameters<typeof getOrLoadIpRotateConfig>[0];

  await getOrLoadIpRotateConfig(env, cache);

  const entry: CachedConfigEntry | undefined = cache.get('default');
  expect(entry).toBeDefined();
  expect(entry?.cachedAt).toBe(Date.now());
});

test('getOrLoadIpRotateConfig returns undefined when no config available', async () => {
  const cache: Map<string, CachedConfigEntry> = new Map();
  const env = {} as Parameters<typeof getOrLoadIpRotateConfig>[0];

  const result: IpRotateConfig | undefined = await getOrLoadIpRotateConfig(env, cache);

  expect(result).toBeUndefined();
  expect(cache.size).toBe(0);
});

test('getExecutionCtx returns undefined when context throws', () => {
  const mockContext: Record<string, unknown> = {};
  Object.defineProperty(mockContext, 'executionCtx', {
    get(): never {
      throw new Error('No ExecutionContext');
    },
  });
  const result: ExecutionContext | undefined = getExecutionCtx(
    mockContext as unknown as Parameters<typeof getExecutionCtx>[0],
  );
  expect(result).toBeUndefined();
});

test('getExecutionCtx returns context when available', () => {
  const mockCtx: Record<string, unknown> = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };
  const mockContext: Record<string, unknown> = { executionCtx: mockCtx };
  const result: ExecutionContext | undefined = getExecutionCtx(
    mockContext as unknown as Parameters<typeof getExecutionCtx>[0],
  );
  expect(result).toBe(mockCtx);
});

test('syncHealthFromDo returns early when ipRotateConfig is undefined', async () => {
  const params: SyncHealthFromDoParams = {
    ipRotateConfig: undefined,
    healthCoordinator: {} as DurableObjectNamespace,
    targetQuery: 'https://example.com',
  };
  await syncHealthFromDo(params);
  // No error thrown
});

test('syncHealthFromDo returns early when healthCoordinator is undefined', async () => {
  const params: SyncHealthFromDoParams = {
    ipRotateConfig: MOCK_CONFIG,
    healthCoordinator: undefined,
    targetQuery: 'https://example.com',
  };
  await syncHealthFromDo(params);
  // No error thrown
});

test('syncHealthFromDo returns early when targetQuery is undefined', async () => {
  const params: SyncHealthFromDoParams = {
    ipRotateConfig: MOCK_CONFIG,
    healthCoordinator: {} as DurableObjectNamespace,
    targetQuery: undefined,
  };
  await syncHealthFromDo(params);
  // No error thrown
});

test('syncHealthFromDo handles invalid URL gracefully', async () => {
  const params: SyncHealthFromDoParams = {
    ipRotateConfig: MOCK_CONFIG,
    healthCoordinator: {} as DurableObjectNamespace,
    targetQuery: 'not-a-valid-url',
  };
  await syncHealthFromDo(params);
  // No error thrown
});

test('syncHealthFromDo returns early when endpoint count is 0', async () => {
  const config: IpRotateConfig = {
    endpoints: {},
    auth: { type: 'api-key', apiKey: 'key1' },
  };
  const params: SyncHealthFromDoParams = {
    ipRotateConfig: config,
    healthCoordinator: {} as DurableObjectNamespace,
    targetQuery: 'https://no-endpoints.com',
  };
  await syncHealthFromDo(params);
  // No error thrown
});
