// Queue module tests
// Execute with bun: wrangler dev

import { expect, test } from 'vitest';
import type { BatchFetchResult, FetchTask } from '../../types.ts';
import {
  appendRetryTasks,
  createInitialQueue,
  createRetryTask,
  markRemainingAsSkipped,
  takeBatch,
} from './queue.ts';

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

test('createInitialQueue creates tasks with isRetry false', () => {
  const queue: FetchTask[] = createInitialQueue(['https://example.com']);
  const task: FetchTask | undefined = queue[0];
  expect(task?.isRetry).toStrictEqual(false);
});

// takeBatch tests
test('takeBatch takes up to 6 items from queue', () => {
  const queue: FetchTask[] = [
    { url: 'https://0.com', index: 0, isRetry: false },
    { url: 'https://1.com', index: 1, isRetry: false },
    { url: 'https://2.com', index: 2, isRetry: false },
    { url: 'https://3.com', index: 3, isRetry: false },
    { url: 'https://4.com', index: 4, isRetry: false },
    { url: 'https://5.com', index: 5, isRetry: false },
    { url: 'https://6.com', index: 6, isRetry: false },
    { url: 'https://7.com', index: 7, isRetry: false },
  ];
  const batch: FetchTask[] = takeBatch(queue);
  expect(batch.length).toStrictEqual(6);
  expect(queue.length).toStrictEqual(2);
});

test('takeBatch takes all items if less than 6', () => {
  const queue: FetchTask[] = [
    { url: 'https://0.com', index: 0, isRetry: false },
    { url: 'https://1.com', index: 1, isRetry: false },
  ];
  const batch: FetchTask[] = takeBatch(queue);
  expect(batch.length).toStrictEqual(2);
  expect(queue.length).toStrictEqual(0);
});

test('takeBatch returns empty array for empty queue', () => {
  const queue: FetchTask[] = [];
  const batch: FetchTask[] = takeBatch(queue);
  expect(batch.length).toStrictEqual(0);
});

test('takeBatch modifies original queue', () => {
  const queue: FetchTask[] = [
    { url: 'https://0.com', index: 0, isRetry: false },
    { url: 'https://1.com', index: 1, isRetry: false },
  ];
  takeBatch(queue);
  expect(queue.length).toStrictEqual(0);
});

// createRetryTask tests
test('createRetryTask creates task with isRetry true', () => {
  const task: FetchTask = { url: 'https://example.com', index: 5, isRetry: false };
  const retryTask: FetchTask = createRetryTask(task);
  expect(retryTask.url).toStrictEqual('https://example.com');
  expect(retryTask.index).toStrictEqual(5);
  expect(retryTask.isRetry).toStrictEqual(true);
});

test('createRetryTask preserves url and index', () => {
  const task: FetchTask = { url: 'https://test.org/path', index: 10, isRetry: false };
  const retryTask: FetchTask = createRetryTask(task);
  expect(retryTask.url).toStrictEqual('https://test.org/path');
  expect(retryTask.index).toStrictEqual(10);
});

// appendRetryTasks tests
test('appendRetryTasks adds tasks to queue', () => {
  const queue: FetchTask[] = [];
  const retryQueue: readonly FetchTask[] = [{ url: 'https://a.com', index: 0, isRetry: true }];
  appendRetryTasks(queue, retryQueue);
  expect(queue.length).toStrictEqual(1);
});

test('appendRetryTasks appends to existing queue', () => {
  const queue: FetchTask[] = [{ url: 'https://existing.com', index: 0, isRetry: false }];
  const retryQueue: readonly FetchTask[] = [{ url: 'https://retry.com', index: 1, isRetry: true }];
  appendRetryTasks(queue, retryQueue);
  expect(queue.length).toStrictEqual(2);
  expect(queue[1]?.url).toStrictEqual('https://retry.com');
});

test('appendRetryTasks handles empty retry queue', () => {
  const queue: FetchTask[] = [{ url: 'https://a.com', index: 0, isRetry: false }];
  appendRetryTasks(queue, []);
  expect(queue.length).toStrictEqual(1);
});

// markRemainingAsSkipped tests
test('markRemainingAsSkipped marks unprocessed tasks', () => {
  const results: (BatchFetchResult | null)[] = [
    { url: 'https://a.com', httpStatus: 200, result: 'success', body: 'ok' },
    null,
    null,
  ];
  const queue: readonly FetchTask[] = [
    { url: 'https://b.com', index: 1, isRetry: false },
    { url: 'https://c.com', index: 2, isRetry: false },
  ];
  markRemainingAsSkipped(queue, results);
  expect(results[1]?.result).toStrictEqual('skipped');
  expect(results[2]?.result).toStrictEqual('skipped');
});

test('markRemainingAsSkipped does not overwrite existing results', () => {
  const existingResult: BatchFetchResult = {
    url: 'https://a.com',
    httpStatus: 200,
    result: 'success',
    body: 'ok',
  };
  const results: (BatchFetchResult | null)[] = [existingResult];
  const queue: readonly FetchTask[] = [{ url: 'https://a.com', index: 0, isRetry: false }];
  markRemainingAsSkipped(queue, results);
  expect(results[0]).toStrictEqual(existingResult);
});

test('markRemainingAsSkipped handles empty queue', () => {
  const results: (BatchFetchResult | null)[] = [null];
  markRemainingAsSkipped([], results);
  expect(results[0]).toStrictEqual(null);
});
