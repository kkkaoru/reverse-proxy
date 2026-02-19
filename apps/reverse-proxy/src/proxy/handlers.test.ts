// Proxy handlers aggregation module tests
// Execute with bun: bun run test

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHandlerMap, createHandlerMaps } from './handlers.ts';
import type { ProxyCacheOptions } from './types.ts';

const createMockOptions = (): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('createHandlerMaps returns queryHandlers with GET, HEAD, DELETE and batchHandler', () => {
  const options: ProxyCacheOptions = createMockOptions();
  const maps = createHandlerMaps(options);
  expect(typeof maps.queryHandlers.GET).toBe('function');
  expect(typeof maps.queryHandlers.HEAD).toBe('function');
  expect(typeof maps.queryHandlers.DELETE).toBe('function');
  expect(typeof maps.batchHandler).toBe('function');
});

test('createHandlerMap returns queryHandlers only (legacy)', () => {
  const options: ProxyCacheOptions = createMockOptions();
  const handlers = createHandlerMap(options);
  expect(typeof handlers.GET).toBe('function');
  expect(typeof handlers.HEAD).toBe('function');
  expect(typeof handlers.DELETE).toBe('function');
});

test('createHandlerMaps GET handler returns response for valid URL', async () => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
  );
  const options: ProxyCacheOptions = createMockOptions();
  const maps = createHandlerMaps(options);
  const getHandler = maps.queryHandlers.GET;
  expect(getHandler).toBeDefined();
  if (!getHandler) return;
  const response: Response = await getHandler('https://example.com');
  expect(response.status).toBe(200);
});

test('createHandlerMaps DELETE handler returns response for invalid URL', async () => {
  const options: ProxyCacheOptions = createMockOptions();
  const maps = createHandlerMaps(options);
  const deleteHandler = maps.queryHandlers.DELETE;
  expect(deleteHandler).toBeDefined();
  if (!deleteHandler) return;
  const response: Response = await deleteHandler('not-a-url');
  expect(response.status).toBe(400);
});

test('createHandlerMaps batchHandler returns response for null body', async () => {
  const options: ProxyCacheOptions = createMockOptions();
  const maps = createHandlerMaps(options);
  const response: Response = await maps.batchHandler(null);
  expect(response.status).toBe(400);
});
