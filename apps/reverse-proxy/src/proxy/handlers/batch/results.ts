// Batch result creation and type guards
// Execute with bun: wrangler dev

import {
  ERROR_FETCH_FAILED,
  RESULT_ERROR,
  RESULT_SKIPPED,
  STATUS_BAD_GATEWAY,
} from '../../constants.ts';
import type { BatchFetchResult, FetchTask, FulfilledResult, SettledResult } from '../../types.ts';

// Type guard for fulfilled results
export const isFulfilled = (result: SettledResult): result is FulfilledResult =>
  result.status === 'fulfilled';

// Check if result is failed (4xx or 5xx)
export const isFailedResult = (result: BatchFetchResult): boolean => result.httpStatus >= 400;

// Create error result for rejected promises
export const createErrorResult = (task: FetchTask): BatchFetchResult => ({
  url: task.url,
  httpStatus: STATUS_BAD_GATEWAY,
  result: RESULT_ERROR,
  body: ERROR_FETCH_FAILED,
});

// Create skipped result
export const createSkippedResult = (task: FetchTask): BatchFetchResult => ({
  url: task.url,
  httpStatus: 0,
  result: RESULT_SKIPPED,
  body: 'Skipped due to resource limit',
});

// Extract result from settled promise
export const extractResultFromSettled = (
  settled: SettledResult,
  task: FetchTask,
): BatchFetchResult => (isFulfilled(settled) ? settled.value : createErrorResult(task));

// Fill null results with skipped
export const fillNullResults = (
  urls: readonly string[],
  results: readonly (BatchFetchResult | null)[],
): readonly BatchFetchResult[] =>
  results.map((result: BatchFetchResult | null, index: number): BatchFetchResult => {
    if (result !== null) {
      return result;
    }
    const url: string = urls[index] ?? '';
    return { url, httpStatus: 0, result: RESULT_SKIPPED, body: 'Not processed' };
  });
