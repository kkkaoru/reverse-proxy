// Tests for health state synchronization across 3 tiers
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  DoHealthResult,
  ModuleCacheEntry,
  ReportOutcomeParams,
  SyncHealthParams,
} from './health-sync.ts';
import {
  clearModuleHealthCache,
  DO_INSTANCE_NAME,
  inflightRequests,
  isModuleCacheFresh,
  MODULE_CACHE_TTL_MS,
  mergeHealthIntoCounters,
  moduleHealthCache,
  reportOutcomeToDO,
  syncHealthToCounters,
} from './health-sync.ts';

const mockGetHealthCounters: ReturnType<typeof vi.fn> = vi.fn();
const mockReportOutcome: ReturnType<typeof vi.fn> = vi.fn();
const mockGet: ReturnType<typeof vi.fn> = vi.fn();
const mockIdFromName: ReturnType<typeof vi.fn> = vi.fn();

interface MockDoNamespace {
  idFromName: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

const createMockNamespace = (): MockDoNamespace => {
  mockIdFromName.mockReturnValue('mock-id');
  mockGet.mockReturnValue({
    getHealthCounters: mockGetHealthCounters,
    reportOutcome: mockReportOutcome,
  });
  return { idFromName: mockIdFromName, get: mockGet };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  clearModuleHealthCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('MODULE_CACHE_TTL_MS is 2000', () => {
  expect(MODULE_CACHE_TTL_MS).toBe(2000);
});

test('DO_INSTANCE_NAME is default', () => {
  expect(DO_INSTANCE_NAME).toBe('default');
});

test('isModuleCacheFresh returns false for undefined', () => {
  expect(isModuleCacheFresh(undefined)).toBe(false);
});

test('isModuleCacheFresh returns true for fresh entry', () => {
  const entry: ModuleCacheEntry = { data: {}, cachedAt: Date.now() };
  expect(isModuleCacheFresh(entry)).toBe(true);
});

test('isModuleCacheFresh returns true for entry within TTL', () => {
  const entry: ModuleCacheEntry = { data: {}, cachedAt: Date.now() - 1999 };
  expect(isModuleCacheFresh(entry)).toBe(true);
});

test('isModuleCacheFresh returns false for expired entry', () => {
  const entry: ModuleCacheEntry = { data: {}, cachedAt: Date.now() - 2001 };
  expect(isModuleCacheFresh(entry)).toBe(false);
});

test('isModuleCacheFresh returns false at exactly TTL boundary', () => {
  const entry: ModuleCacheEntry = { data: {}, cachedAt: Date.now() - 2000 };
  expect(isModuleCacheFresh(entry)).toBe(false);
});

test('mergeHealthIntoCounters merges new keys', () => {
  const counters: Map<string, number> = new Map();
  const remote: Record<string, number> = { 'ewma:example.com:0': 0.5, 'ewma:example.com:1': 0.2 };

  mergeHealthIntoCounters(counters, remote);

  expect(counters.get('ewma:example.com:0')).toBe(0.5);
  expect(counters.get('ewma:example.com:1')).toBe(0.2);
});

test('mergeHealthIntoCounters takes higher value', () => {
  const counters: Map<string, number> = new Map([['ewma:example.com:0', 0.8]]);
  const remote: Record<string, number> = { 'ewma:example.com:0': 0.5 };

  mergeHealthIntoCounters(counters, remote);

  expect(counters.get('ewma:example.com:0')).toBe(0.8);
});

test('mergeHealthIntoCounters updates when remote is higher', () => {
  const counters: Map<string, number> = new Map([['ewma:example.com:0', 0.3]]);
  const remote: Record<string, number> = { 'ewma:example.com:0': 0.8 };

  mergeHealthIntoCounters(counters, remote);

  expect(counters.get('ewma:example.com:0')).toBe(0.8);
});

test('mergeHealthIntoCounters keeps local when equal', () => {
  const counters: Map<string, number> = new Map([['ewma:example.com:0', 0.5]]);
  const remote: Record<string, number> = { 'ewma:example.com:0': 0.5 };

  mergeHealthIntoCounters(counters, remote);

  expect(counters.get('ewma:example.com:0')).toBe(0.5);
});

test('clearModuleHealthCache clears module-level cache', () => {
  moduleHealthCache.set('example.com', { data: {}, cachedAt: Date.now() });

  clearModuleHealthCache();

  expect(moduleHealthCache.size).toBe(0);
});

test('syncHealthToCounters returns early when no healthCoordinator', async () => {
  const params: SyncHealthParams = {
    healthCoordinator: undefined,
    counters: new Map(),
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);
  // No error thrown, no external calls made
});

test('syncHealthToCounters uses module cache on hit', async () => {
  const data: Record<string, number> = { 'ewma:example.com:0': 0.5 };
  moduleHealthCache.set('example.com', { data, cachedAt: Date.now() });

  const counters: Map<string, number> = new Map();
  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters,
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  expect(counters.get('ewma:example.com:0')).toBe(0.5);
  expect(mockGetHealthCounters).not.toHaveBeenCalled();
});

test('syncHealthToCounters falls through to Cache API on module cache miss', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(Response.json({ 'ewma:example.com:0': 0.3 }));
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: vi.fn() }),
  });

  const counters: Map<string, number> = new Map();
  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters,
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  expect(counters.get('ewma:example.com:0')).toBe(0.3);
  expect(mockGetHealthCounters).not.toHaveBeenCalled();
});

test('syncHealthToCounters falls through to Durable Object on cache miss', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  const mockCachePut = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: mockCachePut }),
  });

  const doResult: DoHealthResult = {
    counters: { 'ewma:example.com:0': 0.7 },
    keyCount: 1,
  };
  mockGetHealthCounters.mockResolvedValue(doResult);

  const counters: Map<string, number> = new Map();
  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters,
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  expect(counters.get('ewma:example.com:0')).toBe(0.7);
  expect(mockGetHealthCounters).toHaveBeenCalledWith('example.com', 3);
  expect(mockIdFromName).toHaveBeenCalledWith('default');
});

test('syncHealthToCounters populates module cache after DO read', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  const mockCachePut = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: mockCachePut }),
  });

  const doResult: DoHealthResult = {
    counters: { 'ewma:example.com:0': 0.7 },
    keyCount: 1,
  };
  mockGetHealthCounters.mockResolvedValue(doResult);

  const counters: Map<string, number> = new Map();
  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters,
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  const cached: ModuleCacheEntry | undefined = moduleHealthCache.get('example.com');
  expect(cached).toBeDefined();
  expect(cached?.data).toStrictEqual({ 'ewma:example.com:0': 0.7 });
});

test('syncHealthToCounters handles DO RPC error gracefully', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: vi.fn() }),
  });

  mockGetHealthCounters.mockRejectedValue(new Error('DO unavailable'));

  const counters: Map<string, number> = new Map();
  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters,
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);
  // No error thrown, falls back to local counters
  expect(counters.size).toBe(0);
});

test('reportOutcomeToDO returns early when no healthCoordinator', async () => {
  const params: ReportOutcomeParams = {
    healthCoordinator: undefined,
    domain: 'example.com',
    index: 0,
    isSuccess: true,
    isThrottle: false,
    isServerError: false,
  };

  await reportOutcomeToDO(params);
  expect(mockReportOutcome).not.toHaveBeenCalled();
});

test('reportOutcomeToDO calls stub.reportOutcome', async () => {
  mockReportOutcome.mockResolvedValue(undefined);
  const namespace: MockDoNamespace = createMockNamespace();

  const params: ReportOutcomeParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    domain: 'example.com',
    index: 1,
    isSuccess: false,
    isThrottle: true,
    isServerError: false,
  };

  await reportOutcomeToDO(params);

  expect(mockReportOutcome).toHaveBeenCalledWith({
    domain: 'example.com',
    index: 1,
    isSuccess: false,
    isThrottle: true,
    isServerError: false,
  });
});

test('reportOutcomeToDO handles RPC error gracefully', async () => {
  mockReportOutcome.mockRejectedValue(new Error('DO unavailable'));
  const namespace: MockDoNamespace = createMockNamespace();

  const params: ReportOutcomeParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    domain: 'example.com',
    index: 0,
    isSuccess: true,
    isThrottle: false,
    isServerError: false,
  };

  await reportOutcomeToDO(params);
  // No error thrown
});

test('reportOutcomeToDO uses default instance name', async () => {
  mockReportOutcome.mockResolvedValue(undefined);
  const namespace: MockDoNamespace = createMockNamespace();

  const params: ReportOutcomeParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    domain: 'example.com',
    index: 0,
    isSuccess: true,
    isThrottle: false,
    isServerError: false,
  };

  await reportOutcomeToDO(params);

  expect(mockIdFromName).toHaveBeenCalledWith('default');
});

test('clearModuleHealthCache also clears inflightRequests', () => {
  inflightRequests.set('example.com', Promise.resolve());
  moduleHealthCache.set('example.com', { data: {}, cachedAt: Date.now() });

  clearModuleHealthCache();

  expect(inflightRequests.size).toBe(0);
  expect(moduleHealthCache.size).toBe(0);
});

test('syncHealthToCounters single-flight coalesces concurrent DO requests', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  const mockCachePut = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: mockCachePut }),
  });

  const doResult: DoHealthResult = {
    counters: { 'ewma:example.com:0': 0.6 },
    keyCount: 1,
  };
  mockGetHealthCounters.mockResolvedValue(doResult);

  const namespace: MockDoNamespace = createMockNamespace();

  const counters1: Map<string, number> = new Map();
  const counters2: Map<string, number> = new Map();
  const counters3: Map<string, number> = new Map();

  const params1: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters: counters1,
    domain: 'example.com',
    endpointCount: 3,
  };
  const params2: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters: counters2,
    domain: 'example.com',
    endpointCount: 3,
  };
  const params3: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters: counters3,
    domain: 'example.com',
    endpointCount: 3,
  };

  await Promise.all([
    syncHealthToCounters(params1),
    syncHealthToCounters(params2),
    syncHealthToCounters(params3),
  ]);

  // DO should only be called once despite 3 concurrent requests
  expect(mockGetHealthCounters).toHaveBeenCalledTimes(1);
  // All counters should have the data
  expect(counters1.get('ewma:example.com:0')).toBe(0.6);
  expect(counters2.get('ewma:example.com:0')).toBe(0.6);
  expect(counters3.get('ewma:example.com:0')).toBe(0.6);
});

test('syncHealthToCounters cleans up inflightRequests after completion', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  const mockCachePut = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: mockCachePut }),
  });

  const doResult: DoHealthResult = {
    counters: { 'ewma:example.com:0': 0.5 },
    keyCount: 1,
  };
  mockGetHealthCounters.mockResolvedValue(doResult);

  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters: new Map(),
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  expect(inflightRequests.size).toBe(0);
});

test('syncHealthToCounters cleans up inflightRequests on DO error', async () => {
  const mockCacheMatch = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({ match: mockCacheMatch, put: vi.fn() }),
  });

  mockGetHealthCounters.mockRejectedValue(new Error('DO unavailable'));

  const namespace: MockDoNamespace = createMockNamespace();

  const params: SyncHealthParams = {
    healthCoordinator: namespace as unknown as DurableObjectNamespace,
    counters: new Map(),
    domain: 'example.com',
    endpointCount: 3,
  };

  await syncHealthToCounters(params);

  expect(inflightRequests.size).toBe(0);
});
