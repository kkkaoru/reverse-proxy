// Resources module tests
// Execute with bun: wrangler dev

import { expect, test } from 'vitest';
import type { BatchFetchResult, ResourceLimits, ResourceUsage } from '../../types.ts';
import { getResourceUsage, isApproachingLimit } from './resources.ts';

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
  expect(usage.memoryBytes).toStrictEqual(10);
  expect(usage.subrequestCount).toStrictEqual(2);
});

test('getResourceUsage ignores null results', () => {
  const results: (BatchFetchResult | null)[] = [null, null, null];
  const usage: ResourceUsage = getResourceUsage(3, results);
  expect(usage.memoryBytes).toStrictEqual(0);
  expect(usage.subrequestCount).toStrictEqual(3);
});

test('getResourceUsage calculates UTF-16 memory correctly', () => {
  const results: (BatchFetchResult | null)[] = [
    { url: 'https://a.com', httpStatus: 200, result: 'success', body: 'hello' },
  ];
  const usage: ResourceUsage = getResourceUsage(1, results);
  expect(usage.memoryBytes).toStrictEqual(10);
});

test('getResourceUsage handles empty body', () => {
  const results: (BatchFetchResult | null)[] = [
    { url: 'https://a.com', httpStatus: 200, result: 'success', body: '' },
  ];
  const usage: ResourceUsage = getResourceUsage(1, results);
  expect(usage.memoryBytes).toStrictEqual(0);
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

test('isApproachingLimit returns true when memory equals limit', () => {
  const usage: ResourceUsage = { memoryBytes: 100000, subrequestCount: 10 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});

test('isApproachingLimit returns true when subrequests exceed limit', () => {
  const usage: ResourceUsage = { memoryBytes: 1000, subrequestCount: 1001 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});

test('isApproachingLimit returns true when subrequests equal limit', () => {
  const usage: ResourceUsage = { memoryBytes: 1000, subrequestCount: 1000 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});

test('isApproachingLimit returns false when both under limits', () => {
  const usage: ResourceUsage = { memoryBytes: 99999, subrequestCount: 999 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(false);
});

test('isApproachingLimit returns true when both exceed limits', () => {
  const usage: ResourceUsage = { memoryBytes: 100001, subrequestCount: 1001 };
  const limits: ResourceLimits = { maxMemoryBytes: 100000, maxSubrequests: 1000 };
  expect(isApproachingLimit(usage, limits)).toStrictEqual(true);
});
