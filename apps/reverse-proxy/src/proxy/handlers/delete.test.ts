// Delete handler tests
// Execute with bun: bun run test

import { afterEach, beforeEach, expect, type MockInstance, test, vi } from 'vitest';
import type { ProxyCacheOptions } from '../types.ts';
import { handleDeleteRequest } from './delete.ts';

interface MockKV {
  list: MockInstance;
  delete: MockInstance;
  get: MockInstance;
  put: MockInstance;
}

const createMockKV = (): MockKV => ({
  list: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
});

const createMockOptions = (overrides?: Partial<ProxyCacheOptions>): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('handleDeleteRequest returns 400 for invalid URL', async () => {
  const options: ProxyCacheOptions = createMockOptions();
  const response: Response = await handleDeleteRequest('not-a-valid-url', options);
  expect(response.status).toBe(400);
});

test('handleDeleteRequest returns 404 when no cache entries exist and enableCacheApi is false', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.list.mockResolvedValue({ keys: [], list_complete: true, cursor: '' });
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKV as unknown as KVNamespace,
    enableCacheApi: false,
  });
  const response: Response = await handleDeleteRequest('https://example.com/page', options);
  expect(response.status).toBe(404);
  const body = (await response.json()) as {
    deleted: boolean;
    cacheDeleted: boolean;
    kvDeletedCount: number;
  };
  expect(body.deleted).toBe(false);
  expect(body.cacheDeleted).toBe(false);
  expect(body.kvDeletedCount).toBe(0);
});

test('handleDeleteRequest returns 200 when KV has matching keys', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.list.mockResolvedValue({
    keys: [{ name: 'proxy-v1::https://example.com/page::2026-02-20' }],
    list_complete: true,
    cursor: '',
  });
  mockKV.delete.mockResolvedValue(undefined);
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKV as unknown as KVNamespace,
    enableCacheApi: false,
  });
  const response: Response = await handleDeleteRequest('https://example.com/page', options);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { deleted: boolean; kvDeletedCount: number };
  expect(body.deleted).toBe(true);
  expect(body.kvDeletedCount).toBe(1);
});

test('handleDeleteRequest with enableCacheApi true deletes from Cache API', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.list.mockResolvedValue({ keys: [], list_complete: true, cursor: '' });
  const mockCacheDelete: MockInstance = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('caches', {
    default: { delete: mockCacheDelete },
  });
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKV as unknown as KVNamespace,
    enableCacheApi: true,
  });
  const response: Response = await handleDeleteRequest('https://example.com/page', options);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { deleted: boolean; cacheDeleted: boolean };
  expect(body.deleted).toBe(true);
  expect(body.cacheDeleted).toBe(true);
  expect(mockCacheDelete).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('handleDeleteRequest with enableCacheApi true returns 404 when Cache API returns false', async () => {
  const mockKV: MockKV = createMockKV();
  mockKV.list.mockResolvedValue({ keys: [], list_complete: true, cursor: '' });
  const mockCacheDelete: MockInstance = vi.fn().mockResolvedValue(false);
  vi.stubGlobal('caches', {
    default: { delete: mockCacheDelete },
  });
  const options: ProxyCacheOptions = createMockOptions({
    kv: mockKV as unknown as KVNamespace,
    enableCacheApi: true,
  });
  const response: Response = await handleDeleteRequest('https://example.com/page', options);
  expect(response.status).toBe(404);
  const body = (await response.json()) as { deleted: boolean; cacheDeleted: boolean };
  expect(body.deleted).toBe(false);
  expect(body.cacheDeleted).toBe(false);
  vi.unstubAllGlobals();
});

test('handleDeleteRequest without KV returns 404 with zero deletions', async () => {
  const options: ProxyCacheOptions = createMockOptions({ enableCacheApi: false });
  const response: Response = await handleDeleteRequest('https://example.com/page', options);
  expect(response.status).toBe(404);
  const body = (await response.json()) as { deleted: boolean; kvDeletedCount: number };
  expect(body.deleted).toBe(false);
  expect(body.kvDeletedCount).toBe(0);
});
