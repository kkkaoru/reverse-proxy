// Batch handler tests
// Execute with bun: wrangler dev

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  calculateSubrequestCount,
  createBatchExecutionState,
  executeBatchFetch,
  executeSingleBatch,
  shouldStopExecution,
} from '../src/proxy/handlers/batch/execution.ts';
import { fetchSingleUrl } from '../src/proxy/handlers/batch/fetch.ts';
import { handleBatchRequest } from '../src/proxy/handlers/batch/handler.ts';
import {
  processBatchWithAllSettled,
  processSettledResult,
} from '../src/proxy/handlers/batch/processing.ts';
import {
  appendRetryTasks,
  createInitialQueue,
  markRemainingAsSkipped,
  takeBatch,
} from '../src/proxy/handlers/batch/queue.ts';
import { getResourceUsage, isApproachingLimit } from '../src/proxy/handlers/batch/resources.ts';
import {
  extractResultFromSettled,
  fillNullResults,
  isFailedResult,
  isFulfilled,
} from '../src/proxy/handlers/batch/results.ts';
import type {
  BatchExecutionState,
  BatchFetchResult,
  FetchTask,
  FulfilledResult,
  ProcessSettledResultParams,
  ProxyCacheOptions,
  ResourceLimits,
  ResourceUsage,
  SettledResult,
} from '../src/proxy/types.ts';

const createMockOptions = (): ProxyCacheOptions => ({
  enableLogging: false,
  enableCacheApi: false,
  cacheVersion: 'v1',
  ipRotateCounters: new Map(),
});

const createMockBatchResult = (url: string, status: number): BatchFetchResult => ({
  url,
  httpStatus: status,
  result: status < 400 ? 'success' : 'error',
  body: 'test body',
});

const createMockTask = (index: number, isRetry: boolean): FetchTask => ({
  url: `https://example${index}.com`,
  index,
  isRetry,
});

const mockFetch: ReturnType<typeof vi.fn> = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// isFulfilled tests
test('isFulfilled returns true for fulfilled result', () => {
  const fulfilled: SettledResult = {
    status: 'fulfilled',
    value: createMockBatchResult('https://example.com', 200),
  };
  expect(isFulfilled(fulfilled)).toStrictEqual(true);
});

test('isFulfilled returns false for rejected result', () => {
  const rejected: SettledResult = { status: 'rejected', reason: new Error('test error') };
  expect(isFulfilled(rejected)).toStrictEqual(false);
});

// isFailedResult tests
test('isFailedResult returns true for 400 status', () => {
  const result: BatchFetchResult = createMockBatchResult('https://example.com', 400);
  expect(isFailedResult(result)).toStrictEqual(true);
});

test('isFailedResult returns true for 500 status', () => {
  const result: BatchFetchResult = createMockBatchResult('https://example.com', 500);
  expect(isFailedResult(result)).toStrictEqual(true);
});

test('isFailedResult returns false for 200 status', () => {
  const result: BatchFetchResult = createMockBatchResult('https://example.com', 200);
  expect(isFailedResult(result)).toStrictEqual(false);
});

test('isFailedResult returns false for 301 status', () => {
  const result: BatchFetchResult = createMockBatchResult('https://example.com', 301);
  expect(isFailedResult(result)).toStrictEqual(false);
});

// extractResultFromSettled tests
test('extractResultFromSettled returns value for fulfilled', () => {
  const mockResult: BatchFetchResult = createMockBatchResult('https://example.com', 200);
  const fulfilled: FulfilledResult = { status: 'fulfilled', value: mockResult };
  const task: FetchTask = createMockTask(0, false);
  const result: BatchFetchResult = extractResultFromSettled(fulfilled, task);
  expect(result).toStrictEqual(mockResult);
});

test('extractResultFromSettled returns error result for rejected', () => {
  const rejected: SettledResult = { status: 'rejected', reason: new Error('test') };
  const task: FetchTask = createMockTask(0, false);
  const result: BatchFetchResult = extractResultFromSettled(rejected, task);
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(502);
});

// getResourceUsage tests
test('getResourceUsage returns zero memory for empty results', () => {
  const usage: ResourceUsage = getResourceUsage(0, []);
  expect(usage.memoryBytes).toStrictEqual(0);
  expect(usage.subrequestCount).toStrictEqual(0);
});

test('getResourceUsage calculates memory for results', () => {
  const results: (BatchFetchResult | null)[] = [
    { url: 'https://a.com', httpStatus: 200, result: 'success', body: 'abc' },
    null,
    { url: 'https://b.com', httpStatus: 200, result: 'success', body: 'de' },
  ];
  const usage: ResourceUsage = getResourceUsage(2, results);
  expect(usage.memoryBytes).toStrictEqual(10); // (3 + 2) * 2 = 10
  expect(usage.subrequestCount).toStrictEqual(2);
});

// isApproachingLimit tests
test('isApproachingLimit returns false when under limits', () => {
  const usage: ResourceUsage = { memoryBytes: 1000, subrequestCount: 10 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(false);
});

test('isApproachingLimit returns true when memory exceeds limit', () => {
  const usage: ResourceUsage = { memoryBytes: 100001, subrequestCount: 10 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});

test('isApproachingLimit returns true when subrequests exceed limit', () => {
  const usage: ResourceUsage = { memoryBytes: 1000, subrequestCount: 1001 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});

// createInitialQueue tests
test('createInitialQueue creates tasks with correct indices', () => {
  const urls: readonly string[] = ['https://a.com', 'https://b.com'];
  const queue: FetchTask[] = createInitialQueue(urls);
  expect(queue.length).toStrictEqual(2);
  const first: FetchTask | undefined = queue[0];
  const second: FetchTask | undefined = queue[1];
  expect(first?.url).toStrictEqual('https://a.com');
  expect(first?.index).toStrictEqual(0);
  expect(first?.isRetry).toStrictEqual(false);
  expect(second?.url).toStrictEqual('https://b.com');
  expect(second?.index).toStrictEqual(1);
  expect(second?.isRetry).toStrictEqual(false);
});

test('createInitialQueue returns empty array for empty input', () => {
  const queue: FetchTask[] = createInitialQueue([]);
  expect(queue.length).toStrictEqual(0);
});

// takeBatch tests
test('takeBatch takes up to 6 items from queue', () => {
  const queue: FetchTask[] = [
    createMockTask(0, false),
    createMockTask(1, false),
    createMockTask(2, false),
    createMockTask(3, false),
    createMockTask(4, false),
    createMockTask(5, false),
    createMockTask(6, false),
    createMockTask(7, false),
  ];
  const batch: FetchTask[] = takeBatch(queue);
  expect(batch.length).toStrictEqual(6);
  expect(queue.length).toStrictEqual(2);
});

test('takeBatch takes all items if less than 6', () => {
  const queue: FetchTask[] = [createMockTask(0, false), createMockTask(1, false)];
  const batch: FetchTask[] = takeBatch(queue);
  expect(batch.length).toStrictEqual(2);
  expect(queue.length).toStrictEqual(0);
});

// fetchSingleUrl tests
test('fetchSingleUrl returns ssrf_blocked for localhost', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://localhost/admin',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns ssrf_blocked for private IP', async () => {
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://10.0.0.1/internal',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('ssrf_blocked');
  expect(result.httpStatus).toStrictEqual(422);
});

test('fetchSingleUrl returns success for valid URL', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('success');
  expect(result.httpStatus).toStrictEqual(200);
});

test('fetchSingleUrl returns error for 500 response', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response('server error', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }),
  );
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(500);
});

test('fetchSingleUrl returns error when fetch throws', async () => {
  mockFetch.mockRejectedValueOnce(new Error('network error'));
  const result: BatchFetchResult = await fetchSingleUrl({
    url: 'https://example.com',
    options: createMockOptions(),
  });
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(502);
});

// processBatchWithAllSettled tests
test('processBatchWithAllSettled returns results for all tasks', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok1', { status: 200 }));
  mockFetch.mockResolvedValueOnce(new Response('ok2', { status: 200 }));
  const tasks: readonly FetchTask[] = [createMockTask(0, false), createMockTask(1, false)];
  const results: readonly SettledResult[] = await processBatchWithAllSettled({
    tasks,
    options: createMockOptions(),
  });
  expect(results.length).toStrictEqual(2);
});

// processSettledResult tests
test('processSettledResult stores result for success', () => {
  const results: (BatchFetchResult | null)[] = [null];
  const retried: Set<number> = new Set();
  const retryQueue: FetchTask[] = [];
  const mockResult: BatchFetchResult = createMockBatchResult('https://example.com', 200);
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: createMockTask(0, false),
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
  const mockResult: BatchFetchResult = createMockBatchResult('https://example.com', 500);
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: createMockTask(0, false),
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
  const mockResult: BatchFetchResult = createMockBatchResult('https://example.com', 500);
  const params: ProcessSettledResultParams = {
    settled: { status: 'fulfilled', value: mockResult },
    task: createMockTask(0, true),
    results,
    retried,
    retryQueue,
  };
  processSettledResult(params);
  expect(results[0]).toStrictEqual(mockResult);
  expect(retryQueue.length).toStrictEqual(0);
});

// markRemainingAsSkipped tests
test('markRemainingAsSkipped marks unprocessed tasks', () => {
  const results: (BatchFetchResult | null)[] = [
    createMockBatchResult('https://a.com', 200),
    null,
    null,
  ];
  const queue: readonly FetchTask[] = [createMockTask(1, false), createMockTask(2, false)];
  markRemainingAsSkipped(queue, results);
  expect(results[1]?.result).toStrictEqual('skipped');
  expect(results[2]?.result).toStrictEqual('skipped');
});

// fillNullResults tests
test('fillNullResults fills null with skipped', () => {
  const results: readonly (BatchFetchResult | null)[] = [
    createMockBatchResult('https://a.com', 200),
    null,
  ];
  const filled: readonly BatchFetchResult[] = fillNullResults(
    ['https://a.com', 'https://b.com'],
    results,
  );
  const secondResult: BatchFetchResult | undefined = filled[1];
  expect(secondResult?.result).toStrictEqual('skipped');
  expect(secondResult?.url).toStrictEqual('https://b.com');
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

// calculateSubrequestCount tests
test('calculateSubrequestCount returns correct count', () => {
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

// appendRetryTasks tests
test('appendRetryTasks adds tasks to queue', () => {
  const queue: FetchTask[] = [];
  const retryQueue: readonly FetchTask[] = [createMockTask(0, true)];
  appendRetryTasks(queue, retryQueue);
  expect(queue.length).toStrictEqual(1);
});

// executeSingleBatch tests
test('executeSingleBatch processes batch and adds retry tasks', async () => {
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

// executeBatchFetch tests
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

// handleBatchRequest tests
interface ErrorBody {
  error: string;
}

interface BatchResultBody extends Array<BatchFetchResult> {}

test('handleBatchRequest returns error for invalid body', async () => {
  const response: Response = await handleBatchRequest(null, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must be valid JSON');
});

test('handleBatchRequest returns error for missing urls', async () => {
  const response: Response = await handleBatchRequest({ other: 'field' }, createMockOptions());
  expect(response.status).toStrictEqual(400);
  const body: ErrorBody = await response.json();
  expect(body.error).toStrictEqual('Request body must contain "urls" array');
});

test('handleBatchRequest returns results for valid request', async () => {
  mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
  const response: Response = await handleBatchRequest(
    { urls: ['https://example.com'] },
    createMockOptions(),
  );
  expect(response.status).toStrictEqual(200);
  const body: BatchResultBody = await response.json();
  expect(body.length).toStrictEqual(1);
  const first: BatchFetchResult | undefined = body[0];
  expect(first?.result).toStrictEqual('success');
});

describe('handleBatchRequest edge cases', () => {
  test('handles empty urls array', async () => {
    const response: Response = await handleBatchRequest({ urls: [] }, createMockOptions());
    expect(response.status).toStrictEqual(200);
    const body: BatchResultBody = await response.json();
    expect(body.length).toStrictEqual(0);
  });

  test('handles mixed success and failure urls', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response: Response = await handleBatchRequest(
      { urls: ['https://example.com', 'https://localhost/admin'] },
      createMockOptions(),
    );
    expect(response.status).toStrictEqual(200);
    const body: BatchResultBody = await response.json();
    expect(body.length).toStrictEqual(2);
    const first: BatchFetchResult | undefined = body[0];
    const second: BatchFetchResult | undefined = body[1];
    expect(first?.result).toStrictEqual('success');
    expect(second?.result).toStrictEqual('ssrf_blocked');
  });
});
