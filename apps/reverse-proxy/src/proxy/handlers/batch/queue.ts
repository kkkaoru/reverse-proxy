// Batch queue management
// Execute with bun: wrangler dev

import { MAX_CONCURRENT_REQUESTS } from '../../constants.ts';
import type { BatchFetchResult, FetchTask } from '../../types.ts';
import { createSkippedResult } from './results.ts';

// Create initial queue from URLs
export const createInitialQueue = (urls: readonly string[]): FetchTask[] =>
  urls.map((url: string, index: number): FetchTask => ({ url, index, isRetry: false }));

// Take batch from queue
export const takeBatch = (queue: FetchTask[]): FetchTask[] =>
  queue.splice(0, MAX_CONCURRENT_REQUESTS);

// Create retry task
export const createRetryTask = (task: FetchTask): FetchTask => ({
  url: task.url,
  index: task.index,
  isRetry: true,
});

// Append retry tasks to queue
export const appendRetryTasks = (queue: FetchTask[], retryQueue: readonly FetchTask[]): void => {
  retryQueue.map((task: FetchTask) => {
    queue.push(task);
    return task;
  });
};

// Mark remaining tasks as skipped
export const markRemainingAsSkipped = (
  queue: readonly FetchTask[],
  results: (BatchFetchResult | null)[],
): void => {
  queue
    .filter((task: FetchTask): boolean => results[task.index] === null)
    .map((task: FetchTask) => {
      results[task.index] = createSkippedResult(task);
      return task;
    });
};
