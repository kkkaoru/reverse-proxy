// Batch execution state and control
// Execute with bun: wrangler dev

import { MAX_MEMORY_BYTES, MAX_SUBREQUESTS } from '../../constants.ts';
import type {
  BatchExecutionState,
  BatchFetchParams,
  BatchFetchResult,
  ExecuteSingleBatchParams,
  FetchTask,
  LoopIterationParams,
  ResourceUsage,
  SettledResult,
} from '../../types.ts';
import { processBatchResults, processBatchWithAllSettled } from './processing.ts';
import {
  appendRetryTasks,
  createInitialQueue,
  markRemainingAsSkipped,
  takeBatch,
} from './queue.ts';
import { getResourceUsage, isApproachingLimit } from './resources.ts';
import { fillNullResults } from './results.ts';

// Create batch execution state
export const createBatchExecutionState = (params: BatchFetchParams): BatchExecutionState => ({
  limits: { maxMemoryBytes: MAX_MEMORY_BYTES, maxSubrequests: MAX_SUBREQUESTS },
  results: Array.from({ length: params.urls.length }, (): null => null),
  retried: new Set(),
  queue: createInitialQueue(params.urls),
  options: params.options,
});

// Calculate subrequest count
export const calculateSubrequestCount = (params: LoopIterationParams): number =>
  params.urlCount - params.state.queue.length + params.state.retried.size;

// Check if should stop execution
export const shouldStopExecution = (params: LoopIterationParams): boolean => {
  const subrequestCount: number = calculateSubrequestCount(params);
  const usage: ResourceUsage = getResourceUsage(subrequestCount, params.state.results);
  return isApproachingLimit(usage, params.state.limits);
};

// Execute single batch
export const executeSingleBatch = async (params: ExecuteSingleBatchParams): Promise<void> => {
  const batch: FetchTask[] = takeBatch(params.state.queue);
  const settledResults: readonly SettledResult[] = await processBatchWithAllSettled({
    tasks: batch,
    options: params.state.options,
  });
  const retryQueue: FetchTask[] = [];
  processBatchResults({
    settledResults,
    tasks: batch,
    results: params.state.results,
    retried: params.state.retried,
    retryQueue,
  });
  appendRetryTasks(params.state.queue, retryQueue);
};

// Process all batches recursively (avoids await in loop)
const processAllBatches = async (state: BatchExecutionState, urlCount: number): Promise<void> => {
  if (state.queue.length === 0) {
    return;
  }

  if (shouldStopExecution({ state, urlCount })) {
    markRemainingAsSkipped(state.queue, state.results);
    return;
  }

  await executeSingleBatch({ state });
  return processAllBatches(state, urlCount);
};

// Execute batch fetch with retry and resource monitoring
export const executeBatchFetch = async (
  params: BatchFetchParams,
): Promise<readonly BatchFetchResult[]> => {
  const state: BatchExecutionState = createBatchExecutionState(params);
  await processAllBatches(state, params.urls.length);
  return fillNullResults(params.urls, state.results);
};
