// Batch processing logic
// Execute with bun: wrangler dev

import type {
  BatchFetchResult,
  FetchTask,
  ProcessBatchParams,
  ProcessSettledResultParams,
  SettledResult,
} from '../../types.ts';
import { fetchSingleUrl } from './fetch.ts';
import { createRetryTask } from './queue.ts';
import { extractResultFromSettled, isFailedResult } from './results.ts';
import type { ProcessBatchResultsParams } from './types.ts';

// Check if result is retryable (not ssrf_blocked, not skipped)
const isRetryableResult = (result: BatchFetchResult): boolean =>
  result.result !== 'ssrf_blocked' && result.result !== 'skipped';

// Check if should retry
const shouldRetry = (result: BatchFetchResult, task: FetchTask, retried: Set<number>): boolean =>
  isFailedResult(result) && isRetryableResult(result) && !task.isRetry && !retried.has(task.index);

// Process batch with Promise.allSettled
export const processBatchWithAllSettled = (
  params: ProcessBatchParams,
): Promise<readonly SettledResult[]> =>
  Promise.allSettled(
    params.tasks.map(
      (task: FetchTask): Promise<BatchFetchResult> =>
        fetchSingleUrl({ url: task.url, options: params.options }),
    ),
  );

// Process single settled result
export const processSettledResult = (params: ProcessSettledResultParams): void => {
  const result: BatchFetchResult = extractResultFromSettled(params.settled, params.task);

  if (!shouldRetry(result, params.task, params.retried)) {
    params.results[params.task.index] = result;
    return;
  }

  params.retried.add(params.task.index);
  params.retryQueue.push(createRetryTask(params.task));
};

// Process batch results
export const processBatchResults = (params: ProcessBatchResultsParams): void => {
  params.settledResults.map((settled: SettledResult, i: number) => {
    const task: FetchTask | undefined = params.tasks[i];
    if (task === undefined) {
      return settled;
    }
    processSettledResult({
      settled,
      task,
      results: params.results,
      retried: params.retried,
      retryQueue: params.retryQueue,
    });
    return settled;
  });
};
