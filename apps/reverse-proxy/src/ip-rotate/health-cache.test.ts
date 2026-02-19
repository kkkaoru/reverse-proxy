// Tests for Cache API health state operations
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  buildCacheUrl,
  CONTENT_TYPE_JSON,
  HEALTH_CACHE_NAME,
  HEALTH_CACHE_TTL_SECONDS,
  HEALTH_CACHE_URL_PREFIX,
  readHealthFromCache,
  writeHealthToCache,
} from './health-cache.ts';

interface MockCache {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

const createMockCache = (): MockCache => ({
  match: vi.fn(),
  put: vi.fn(),
});

const mockOpen: ReturnType<typeof vi.fn> = vi.fn();

beforeEach(() => {
  vi.stubGlobal('caches', { open: mockOpen });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('HEALTH_CACHE_NAME is ip-rotate-health', () => {
  expect(HEALTH_CACHE_NAME).toBe('ip-rotate-health');
});

test('HEALTH_CACHE_TTL_SECONDS is 2', () => {
  expect(HEALTH_CACHE_TTL_SECONDS).toBe(2);
});

test('HEALTH_CACHE_URL_PREFIX is https://health-cache.internal/', () => {
  expect(HEALTH_CACHE_URL_PREFIX).toBe('https://health-cache.internal/');
});

test('CONTENT_TYPE_JSON is application/json', () => {
  expect(CONTENT_TYPE_JSON).toBe('application/json');
});

test('buildCacheUrl returns prefixed URL for domain', () => {
  expect(buildCacheUrl('example.com')).toBe('https://health-cache.internal/example.com');
});

test('buildCacheUrl returns prefixed URL for subdomain', () => {
  expect(buildCacheUrl('api.example.com')).toBe('https://health-cache.internal/api.example.com');
});

test('readHealthFromCache returns null on cache miss', async () => {
  const cache: MockCache = createMockCache();
  cache.match.mockResolvedValue(undefined);
  mockOpen.mockResolvedValue(cache);

  const result: Record<string, number> | null = await readHealthFromCache('example.com');

  expect(result).toBeNull();
  expect(mockOpen).toHaveBeenCalledWith('ip-rotate-health');
  expect(cache.match).toHaveBeenCalledWith('https://health-cache.internal/example.com');
});

test('readHealthFromCache returns data on cache hit', async () => {
  const data: Record<string, number> = { 'ewma:example.com:0': 0.5, 'ewma:example.com:1': 0.2 };
  const cache: MockCache = createMockCache();
  cache.match.mockResolvedValue(Response.json(data));
  mockOpen.mockResolvedValue(cache);

  const result: Record<string, number> | null = await readHealthFromCache('example.com');

  expect(result).toStrictEqual({ 'ewma:example.com:0': 0.5, 'ewma:example.com:1': 0.2 });
});

test('readHealthFromCache returns null on error', async () => {
  mockOpen.mockRejectedValue(new Error('Cache API unavailable'));

  const result: Record<string, number> | null = await readHealthFromCache('example.com');

  expect(result).toBeNull();
});

test('writeHealthToCache puts response with correct headers', async () => {
  const cache: MockCache = createMockCache();
  cache.put.mockResolvedValue(undefined);
  mockOpen.mockResolvedValue(cache);

  const state: Record<string, number> = { 'ewma:example.com:0': 0.5 };
  await writeHealthToCache('example.com', state);

  expect(mockOpen).toHaveBeenCalledWith('ip-rotate-health');
  expect(cache.put).toHaveBeenCalledTimes(1);

  const callArgs: unknown[] = cache.put.mock.calls[0] as unknown[];
  expect(callArgs[0]).toBe('https://health-cache.internal/example.com');

  const response: Response = callArgs[1] as Response;
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(response.headers.get('Cache-Control')).toBe('max-age=2');

  const body: Record<string, number> = await response.json();
  expect(body).toStrictEqual({ 'ewma:example.com:0': 0.5 });
});

test('writeHealthToCache silently ignores errors', async () => {
  mockOpen.mockRejectedValue(new Error('Cache API unavailable'));

  await writeHealthToCache('example.com', { 'ewma:example.com:0': 0.5 });
  // No error thrown
});

test('readHealthFromCache opens correct cache name', async () => {
  const cache: MockCache = createMockCache();
  cache.match.mockResolvedValue(undefined);
  mockOpen.mockResolvedValue(cache);

  await readHealthFromCache('test.com');

  expect(mockOpen).toHaveBeenCalledWith('ip-rotate-health');
});
