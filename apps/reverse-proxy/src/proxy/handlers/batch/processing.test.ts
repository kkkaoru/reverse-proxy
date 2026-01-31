// Processing module tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BatchFetchResult,
  FetchTask,
  ProcessSettledResultParams,
  ProxyCacheOptions,
  SettledResult,
} from '../../types.ts';
import { processBatchWithAllSettled, processSettledResult } from './processing.ts';

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

// processBatchWithAllSettled tests
test('processBatchWithAllSettled returns results for all tasks', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok1', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('ok2', { status: 200 }));
  const tasks: readonly FetchTask[] = [
    { url: 'https://a.com', index: 0, isRetry: false },
    { url: 'https://b.com', index: 1, isRetry: false },
  ];
  const results: readonly SettledResult[] = await processBatchWithAllSettled({
    tasks,
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(2);
});

test('processBatchWithAllSettled handles mixed success and failure', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  mockFetch.mockRejectedValueOnce(new Error('network error'));
  const tasks: readonly FetchTask[] = [
    { url: 'https://success.com', index: 0, isRetry: false },
    { url: 'https://fail.com', index: 1, isRetry: false },
  ];
  const results: readonly SettledResult[] = await processBatchWithAllSettled({
    tasks,
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(2);
  expect(results[0]?.status).toStrictEqual('fulfilled');
  expect(results[1]?.status).toStrictEqual('fulfilled');
});

test('processBatchWithAllSettled returns empty array for empty tasks', async () => {
  const results: readonly SettledResult[] = await processBatchWithAllSettled({
    tasks: [],
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(0);
});

// processSettledResult tests
test('processSettledResult stores result for success', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 200,
    result: 'success',
    body: 'test',
  };
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: { url: 'https://example.com', index: 0, isRetry: false },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(mockResult);
  expect(retryQueue.length).toStrictEqual(0);
});

test('processSettledResult adds retry task for failed result', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 500,
    result: 'error',
    body: 'server error',
  };
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: { url: 'https://example.com', index: 0, isRetry: false },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(null);
  expect(retryQueue.length).toStrictEqual(1);
  expect(retried.has(0)).toStrictEqual(true);
});

test('processSettledResult does not retry if already retried', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set([0]);
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 500,
    result: 'error',
    body: 'server error',
  };
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: { url: 'https://example.com', index: 0, isRetry: true },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(mockResult);
  expect(retryQueue.length).toStrictEqual(0);
});

test('processSettledResult stores result for 301 redirect', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 301,
    result: 'success',
    body: '',
  };
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: { url: 'https://example.com', index: 0, isRetry: false },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(mockResult);
  expect(retryQueue.length).toStrictEqual(0);
});

test('processSettledResult handles rejected promise', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const params: ProcessSettledResultParams = {
    settled: { status: 'rejected', reason: new Error('test') },
    task: { url: 'https://example.com', index: 0, isRetry: false },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(null);
  expect(retryQueue.length).toStrictEqual(1);
});

test('processSettledResult does not retry ssrf_blocked result', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = {
    url: 'https://localhost/admin',
    httpStatus: 422,
    result: 'ssrf_blocked',
    body: 'Access to this host is not allowed',
  };
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: { url: 'https://localhost/admin', index: 0, isRetry: false },
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(mockResult);
  expect(retryQueue.length).toStrictEqual(0);
});
