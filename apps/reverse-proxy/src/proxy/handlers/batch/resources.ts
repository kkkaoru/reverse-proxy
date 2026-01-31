// Batch resource monitoring
// Execute with bun: wrangler dev

import type { BatchFetchResult, ResourceLimits, ResourceUsage } from '../../types.ts';

// Calculate resource usage
export const getResourceUsage = (
  subrequestCount: number,
  results: readonly (BatchFetchResult | null)[],
): ResourceUsage => {
  const completedResults: readonly BatchFetchResult[] = results.filter(
    (r: BatchFetchResult | null): r is BatchFetchResult => r !== null,
  );
  const memoryBytes: number = completedResults.reduce(
    (sum: number, r: BatchFetchResult): number => sum + r.body.length * 2,
    0,
  );
  return { memoryBytes, subrequestCount };
};

// Check if approaching resource limits
export const isApproachingLimit = (usage: ResourceUsage, limits: ResourceLimits): boolean =>
  usage.memoryBytes >= limits.maxMemoryBytes || usage.subrequestCount >= limits.maxSubrequests;
