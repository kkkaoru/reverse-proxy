// Results module tests
// Execute with bun: wrangler dev

import { expect, test } from 'vitest';
import type { BatchFetchResult, FetchTask, FulfilledResult, SettledResult } from '../../types.ts';
import {
  createErrorResult,
  createSkippedResult,
  extractResultFromSettled,
  fillNullResults,
  isFailedResult,
  isFulfilled,
} from './results.ts';

// isFulfilled tests
test('isFulfilled returns true for fulfilled result', () => {
  const fulfilled: SettledResult = {
    status: 'fulfilled',
    value: { url: 'https://example.com', httpStatus: 200, result: 'success', body: 'test' },
  };
  expect(isFulfilled(fulfilled)).toStrictEqual(true);
});

test('isFulfilled returns false for rejected result', () => {
  const rejected: SettledResult = { status: 'rejected', reason: new Error('test error') };
  expect(isFulfilled(rejected)).toStrictEqual(false);
});

// isFailedResult tests
test('isFailedResult returns true for 400 status', () => {
  const result: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 400,
    result: 'error',
    body: 'bad request',
  };
  expect(isFailedResult(result)).toStrictEqual(true);
});

test('isFailedResult returns true for 500 status', () => {
  const result: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 500,
    result: 'error',
    body: 'server error',
  };
  expect(isFailedResult(result)).toStrictEqual(true);
});

test('isFailedResult returns false for 200 status', () => {
  const result: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 200,
    result: 'success',
    body: 'ok',
  };
  expect(isFailedResult(result)).toStrictEqual(false);
});

test('isFailedResult returns false for 301 status', () => {
  const result: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 301,
    result: 'success',
    body: 'redirect',
  };
  expect(isFailedResult(result)).toStrictEqual(false);
});

test('isFailedResult returns false for 399 status', () => {
  const result: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 399,
    result: 'success',
    body: 'test',
  };
  expect(isFailedResult(result)).toStrictEqual(false);
});

// createErrorResult tests
test('createErrorResult creates error result with 502 status', () => {
  const task: FetchTask = { url: 'https://example.com', index: 0, isRetry: false };
  const result: BatchFetchResult = createErrorResult(task);
  expect(result.url).toStrictEqual('https://example.com');
  expect(result.httpStatus).toStrictEqual(502);
  expect(result.result).toStrictEqual('error');
  expect(result.body).toStrictEqual('Fetch failed');
});

test('createErrorResult preserves task url', () => {
  const task: FetchTask = { url: 'https://test.example.org/path', index: 5, isRetry: true };
  const result: BatchFetchResult = createErrorResult(task);
  expect(result.url).toStrictEqual('https://test.example.org/path');
});

// createSkippedResult tests
test('createSkippedResult creates skipped result with 0 status', () => {
  const task: FetchTask = { url: 'https://example.com', index: 0, isRetry: false };
  const result: BatchFetchResult = createSkippedResult(task);
  expect(result.url).toStrictEqual('https://example.com');
  expect(result.httpStatus).toStrictEqual(0);
  expect(result.result).toStrictEqual('skipped');
  expect(result.body).toStrictEqual('Skipped due to resource limit');
});

// extractResultFromSettled tests
test('extractResultFromSettled returns value for fulfilled', () => {
  const mockResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 200,
    result: 'success',
    body: 'test body',
  };
  const fulfilled: FulfilledResult = { status: 'fulfilled', value: mockResult };
  const task: FetchTask = { url: 'https://example.com', index: 0, isRetry: false };
  const result: BatchFetchResult = extractResultFromSettled(fulfilled, task);
  expect(result).toStrictEqual(mockResult);
});

test('extractResultFromSettled returns error result for rejected', () => {
  const rejected: SettledResult = { status: 'rejected', reason: new Error('test') };
  const task: FetchTask = { url: 'https://example.com', index: 0, isRetry: false };
  const result: BatchFetchResult = extractResultFromSettled(rejected, task);
  expect(result.result).toStrictEqual('error');
  expect(result.httpStatus).toStrictEqual(502);
  expect(result.url).toStrictEqual('https://example.com');
});

// fillNullResults tests
test('fillNullResults fills null with skipped', () => {
  const results: readonly (BatchFetchResult | null)[] = [
    { url: 'https://a.com', httpStatus: 200, result: 'success', body: 'ok' },
    null,
  ];
  const filled: readonly BatchFetchResult[] = fillNullResults(
    ['https://a.com', 'https://b.com'],
    results,
  );
  const first: BatchFetchResult | undefined = filled[0];
  const second: BatchFetchResult | undefined = filled[1];
  expect(first?.result).toStrictEqual('success');
  expect(second?.result).toStrictEqual('skipped');
  expect(second?.url).toStrictEqual('https://b.com');
});

test('fillNullResults preserves existing results', () => {
  const existingResult: BatchFetchResult = {
    url: 'https://example.com',
    httpStatus: 200,
    result: 'success',
    body: 'test',
  };
  const results: readonly (BatchFetchResult | null)[] = [existingResult];
  const filled: readonly BatchFetchResult[] = fillNullResults(['https://example.com'], results);
  expect(filled[0]).toStrictEqual(existingResult);
});

test('fillNullResults handles all nulls', () => {
  const results: readonly (BatchFetchResult | null)[] = [null, null];
  const filled: readonly BatchFetchResult[] = fillNullResults(
    ['https://a.com', 'https://b.com'],
    results,
  );
  const first: BatchFetchResult | undefined = filled[0];
  const second: BatchFetchResult | undefined = filled[1];
  expect(first?.result).toStrictEqual('skipped');
  expect(second?.result).toStrictEqual('skipped');
});

test('fillNullResults handles empty arrays', () => {
  const filled: readonly BatchFetchResult[] = fillNullResults([], []);
  expect(filled.length).toStrictEqual(0);
});
