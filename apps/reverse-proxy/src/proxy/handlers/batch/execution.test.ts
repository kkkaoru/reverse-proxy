// Execution module tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BatchExecutionState, BatchFetchResult, ProxyCacheOptions } from '../../types.ts';
import {
  calculateSubrequestCount,
  createBatchExecutionState,
  executeBatchFetch,
  executeSingleBatch,
  shouldStopExecution,
} from './execution.ts';

const createMockOptions = (): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
});

const mockFetch: ReturnType<typeof vi.fn> = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// createBatchExecutionState tests
test('createBatchExecutionState initializes with correct structure', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com'],
    options: createMockOptions(),
  });
  expect(state.results.length).toStrictEqual(2);
  expect(state.queue.length).toStrictEqual(2);
  expect(state.retried.size).toStrictEqual(0);
});

test('createBatchExecutionState creates null results array', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com'],
    options: createMockOptions(),
  });
  expect(state.results[0]).toStrictEqual(null);
});

test('createBatchExecutionState sets correct limits', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: [],
    options: createMockOptions(),
  });
  expect(state.limits.maxMemoryBytes).toStrictEqual(104857600);
  expect(state.limits.maxSubrequests).toStrictEqual(1000);
});

// calculateSubrequestCount tests
test('calculateSubrequestCount returns correct count for initial state', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com', 'https://c.com'],
    options: createMockOptions(),
  });
  const count: number = calculateSubrequestCount({ state, urlCount: 3 });
  expect(count).toStrictEqual(0);
});

test('calculateSubrequestCount accounts for processed items', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com', 'https://c.com'],
    options: createMockOptions(),
  });
  state.queue.splice(0, 1);
  const count: number = calculateSubrequestCount({ state, urlCount: 3 });
  expect(count).toStrictEqual(1);
});

test('calculateSubrequestCount accounts for retried items', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com', 'https://c.com'],
    options: createMockOptions(),
  });
  state.queue.splice(0, 1);
  state.retried.add(0);
  const count: number = calculateSubrequestCount({ state, urlCount: 3 });
  expect(count).toStrictEqual(2);
});

// shouldStopExecution tests
test('shouldStopExecution returns false when under limits', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com'],
    options: createMockOptions(),
  });
  const result: boolean = shouldStopExecution({ state, urlCount: 1 });
  expect(result).toStrictEqual(false);
});

test('shouldStopExecution returns false for small batch', () => {
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com'],
    options: createMockOptions(),
  });
  state.results[0] = { url: 'https://a.com', httpStatus: 200, result: 'success', body: 'short' };
  const result: boolean = shouldStopExecution({ state, urlCount: 2 });
  expect(result).toStrictEqual(false);
});

// executeSingleBatch tests
test('executeSingleBatch processes batch and updates state', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('fail', { status: 500 }));
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com'],
    options: createMockOptions(),
  });
  await executeSingleBatch({ state });
  expect(state.results[0]).not.toStrictEqual(null);
  expect(state.queue.length).toStrictEqual(1);
});

test('executeSingleBatch handles all successes', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok1', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('ok2', { status: 200 }));
  const state: BatchExecutionState = createBatchExecutionState({
    urls: ['https://a.com', 'https://b.com'],
    options: createMockOptions(),
  });
  await executeSingleBatch({ state });
  expect(state.results[0]).not.toStrictEqual(null);
  expect(state.results[1]).not.toStrictEqual(null);
  expect(state.queue.length).toStrictEqual(0);
});

// executeBatchFetch tests
test('executeBatchFetch returns results for all URLs', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: ['https://example.com'],
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(1);
  const first: BatchFetchResult | undefined = results[0];
  expect(first?.result).toStrictEqual('success');
});

test('executeBatchFetch retries failed requests once', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('fail', { status: 500 }));
  mockFetch.mockResolvedValueOnce(new Response('retry-ok', { status: 200 }));
  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: ['https://a.com', 'https://b.com'],
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(2);
  const first: BatchFetchResult | undefined = results[0];
  const second: BatchFetchResult | undefined = results[1];
  expect(first?.result).toStrictEqual('success');
  expect(second?.result).toStrictEqual('success');
});

test('executeBatchFetch does not retry already retried requests', async () => {
  mockFetch.mockResolvedValueOnce(new Response('fail', { status: 500 }));
  mockFetch.mockResolvedValueOnce(new Response('fail-again', { status: 500 }));
  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: ['https://a.com'],
    options: createMockOptions(),
  });
  const first: BatchFetchResult | undefined = results[0];
  expect(first?.result).toStrictEqual('error');
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('executeBatchFetch handles empty URLs array', async () => {
  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: [],
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(0);
});

test('executeBatchFetch handles SSRF blocked URLs', async () => {
  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: ['https://localhost/admin'],
    options: createMockOptions(),
  });
  const first: BatchFetchResult | undefined = results[0];
  expect(first?.result).toStrictEqual('ssrf_blocked');
  expect(mockFetch).toHaveBeenCalledTimes(0);
});
