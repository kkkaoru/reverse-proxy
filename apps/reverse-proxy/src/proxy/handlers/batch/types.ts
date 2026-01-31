// Batch handler local type definitions
// Execute with bun: wrangler dev

import type { BatchFetchResult, FetchTask, SettledResult } from '../../types.ts';

// Interface for processBatchResults params
export interface ProcessBatchResultsParams {
  readonly settledResults: readonly SettledResult[];
  readonly tasks: readonly FetchTask[];
  readonly results: (BatchFetchResult | null)[];
  readonly retried: Set<number>;
  readonly retryQueue: FetchTask[];
}
