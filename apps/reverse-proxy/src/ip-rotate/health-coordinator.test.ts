// Tests for Durable Object endpoint health coordinator helper functions
// Execute with bun: bunx vitest run

import { expect, test } from 'vitest';
import type { CleanupResult } from './health-coordinator.ts';
import {
  CLEANUP_INTERVAL_MS,
  cleanupStaleEntries,
  filterHealthKeys,
  HEALTH_ENTRY_TTL_MS,
  isHealthKey,
  isKeyForDomain,
  isTimestampKey,
  LOG_PREFIX,
  SAVE_DEBOUNCE_MS,
} from './health-coordinator.ts';

test('HEALTH_ENTRY_TTL_MS is 300000', () => {
  expect(HEALTH_ENTRY_TTL_MS).toBe(300000);
});

test('CLEANUP_INTERVAL_MS is 60000', () => {
  expect(CLEANUP_INTERVAL_MS).toBe(60000);
});

test('SAVE_DEBOUNCE_MS is 1000', () => {
  expect(SAVE_DEBOUNCE_MS).toBe(1000);
});

test('LOG_PREFIX is [health-coordinator]', () => {
  expect(LOG_PREFIX).toBe('[health-coordinator]');
});

test('isTimestampKey returns true for 429 prefix', () => {
  expect(isTimestampKey('429:example.com:0')).toBe(true);
});

test('isTimestampKey returns true for 5xx prefix', () => {
  expect(isTimestampKey('5xx:example.com:0')).toBe(true);
});

test('isTimestampKey returns false for ewma prefix', () => {
  expect(isTimestampKey('ewma:example.com:0')).toBe(false);
});

test('isTimestampKey returns false for ewmats prefix', () => {
  expect(isTimestampKey('ewmats:example.com:0')).toBe(false);
});

test('isTimestampKey returns false for arbitrary key', () => {
  expect(isTimestampKey('other:example.com:0')).toBe(false);
});

test('isHealthKey returns true for 429 prefix', () => {
  expect(isHealthKey('429:example.com:0')).toBe(true);
});

test('isHealthKey returns true for 5xx prefix', () => {
  expect(isHealthKey('5xx:example.com:0')).toBe(true);
});

test('isHealthKey returns true for ewma prefix', () => {
  expect(isHealthKey('ewma:example.com:0')).toBe(true);
});

test('isHealthKey returns true for ewmats prefix', () => {
  expect(isHealthKey('ewmats:example.com:0')).toBe(true);
});

test('isHealthKey returns false for unknown prefix', () => {
  expect(isHealthKey('unknown:example.com:0')).toBe(false);
});

test('isHealthKey returns false for empty string', () => {
  expect(isHealthKey('')).toBe(false);
});

test('isKeyForDomain returns true for matching domain and valid index', () => {
  expect(isKeyForDomain('ewma:example.com:0', 'example.com', 3)).toBe(true);
});

test('isKeyForDomain returns true for last valid index', () => {
  expect(isKeyForDomain('ewma:example.com:2', 'example.com', 3)).toBe(true);
});

test('isKeyForDomain returns false for index equal to endpointCount', () => {
  expect(isKeyForDomain('ewma:example.com:3', 'example.com', 3)).toBe(false);
});

test('isKeyForDomain returns false for different domain', () => {
  expect(isKeyForDomain('ewma:other.com:0', 'example.com', 3)).toBe(false);
});

test('isKeyForDomain returns false for key with too few parts', () => {
  expect(isKeyForDomain('ewma:example.com', 'example.com', 3)).toBe(false);
});

test('isKeyForDomain returns false for negative index', () => {
  expect(isKeyForDomain('ewma:example.com:-1', 'example.com', 3)).toBe(false);
});

test('isKeyForDomain returns false for non-numeric index', () => {
  expect(isKeyForDomain('ewma:example.com:abc', 'example.com', 3)).toBe(false);
});

test('filterHealthKeys returns matching health entries for domain', () => {
  const state: Map<string, number> = new Map([
    ['ewma:example.com:0', 0.5],
    ['ewma:example.com:1', 0.2],
    ['ewma:other.com:0', 0.8],
    ['429:example.com:0', 1000],
    ['random:key', 99],
  ]);

  const result: Record<string, number> = filterHealthKeys(state, 'example.com', 2);

  expect(result).toStrictEqual({
    'ewma:example.com:0': 0.5,
    'ewma:example.com:1': 0.2,
    '429:example.com:0': 1000,
  });
});

test('filterHealthKeys excludes indices beyond endpointCount', () => {
  const state: Map<string, number> = new Map([
    ['ewma:example.com:0', 0.5],
    ['ewma:example.com:1', 0.2],
    ['ewma:example.com:2', 0.8],
  ]);

  const result: Record<string, number> = filterHealthKeys(state, 'example.com', 2);

  expect(result).toStrictEqual({
    'ewma:example.com:0': 0.5,
    'ewma:example.com:1': 0.2,
  });
});

test('filterHealthKeys returns empty object for non-matching domain', () => {
  const state: Map<string, number> = new Map([['ewma:example.com:0', 0.5]]);

  const result: Record<string, number> = filterHealthKeys(state, 'other.com', 2);

  expect(result).toStrictEqual({});
});

test('filterHealthKeys returns empty object for empty state', () => {
  const state: Map<string, number> = new Map();

  const result: Record<string, number> = filterHealthKeys(state, 'example.com', 2);

  expect(result).toStrictEqual({});
});

test('filterHealthKeys includes all health key types', () => {
  const state: Map<string, number> = new Map([
    ['ewma:example.com:0', 0.5],
    ['ewmats:example.com:0', 1000],
    ['429:example.com:0', 2000],
    ['5xx:example.com:0', 3000],
  ]);

  const result: Record<string, number> = filterHealthKeys(state, 'example.com', 1);

  expect(result).toStrictEqual({
    'ewma:example.com:0': 0.5,
    'ewmats:example.com:0': 1000,
    '429:example.com:0': 2000,
    '5xx:example.com:0': 3000,
  });
});

test('cleanupStaleEntries removes expired timestamp entries', () => {
  const now: number = 1000000;
  const state: Map<string, number> = new Map([
    ['429:example.com:0', now - 300001],
    ['5xx:example.com:0', now - 300001],
    ['ewma:example.com:0', 0.5],
  ]);

  const result: CleanupResult = cleanupStaleEntries(state, now);

  expect(result.removedCount).toBe(2);
  expect(result.remainingCount).toBe(1);
  expect(state.has('429:example.com:0')).toBe(false);
  expect(state.has('5xx:example.com:0')).toBe(false);
  expect(state.has('ewma:example.com:0')).toBe(true);
});

test('cleanupStaleEntries keeps fresh timestamp entries', () => {
  const now: number = 1000000;
  const state: Map<string, number> = new Map([
    ['429:example.com:0', now - 100000],
    ['5xx:example.com:0', now - 200000],
  ]);

  const result: CleanupResult = cleanupStaleEntries(state, now);

  expect(result.removedCount).toBe(0);
  expect(result.remainingCount).toBe(2);
});

test('cleanupStaleEntries removes entry at exactly TTL boundary', () => {
  const now: number = 1000000;
  const state: Map<string, number> = new Map([['429:example.com:0', now - 300000]]);

  const result: CleanupResult = cleanupStaleEntries(state, now);

  expect(result.removedCount).toBe(1);
  expect(result.remainingCount).toBe(0);
});

test('cleanupStaleEntries ignores non-timestamp keys', () => {
  const now: number = 1000000;
  const state: Map<string, number> = new Map([
    ['ewma:example.com:0', 0.5],
    ['ewmats:example.com:0', now - 500000],
  ]);

  const result: CleanupResult = cleanupStaleEntries(state, now);

  expect(result.removedCount).toBe(0);
  expect(result.remainingCount).toBe(2);
});

test('cleanupStaleEntries returns zero counts for empty state', () => {
  const state: Map<string, number> = new Map();

  const result: CleanupResult = cleanupStaleEntries(state, Date.now());

  expect(result.removedCount).toBe(0);
  expect(result.remainingCount).toBe(0);
});
