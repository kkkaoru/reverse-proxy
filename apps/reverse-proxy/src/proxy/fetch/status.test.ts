// Tests for status classification helpers
// Execute with bun: bun run test

import { expect, test } from 'vitest';
import { isCacheableStatus, isRedirectStatus, isTransientUpstreamFailureStatus } from './status.ts';

test('isCacheableStatus returns true for 200', () => {
  expect(isCacheableStatus(200)).toBe(true);
});

test('isCacheableStatus returns true for 301', () => {
  expect(isCacheableStatus(301)).toBe(true);
});

test('isCacheableStatus returns false for 400', () => {
  expect(isCacheableStatus(400)).toBe(false);
});

test('isCacheableStatus returns false for 404', () => {
  expect(isCacheableStatus(404)).toBe(false);
});

test('isCacheableStatus returns false for 408', () => {
  expect(isCacheableStatus(408)).toBe(false);
});

test('isCacheableStatus returns false for 429', () => {
  expect(isCacheableStatus(429)).toBe(false);
});

test('isCacheableStatus returns false for 500', () => {
  expect(isCacheableStatus(500)).toBe(false);
});

test('isCacheableStatus returns false for 660 non-standard code', () => {
  expect(isCacheableStatus(660)).toBe(false);
});

test('isRedirectStatus returns true for 301', () => {
  expect(isRedirectStatus(301)).toBe(true);
});

test('isRedirectStatus returns true for 307', () => {
  expect(isRedirectStatus(307)).toBe(true);
});

test('isRedirectStatus returns false for 200', () => {
  expect(isRedirectStatus(200)).toBe(false);
});

test('isRedirectStatus returns false for 400', () => {
  expect(isRedirectStatus(400)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns true for 500', () => {
  expect(isTransientUpstreamFailureStatus(500)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns true for 503', () => {
  expect(isTransientUpstreamFailureStatus(503)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns true for 660 non-standard code', () => {
  expect(isTransientUpstreamFailureStatus(660)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns true for 429 rate limit', () => {
  expect(isTransientUpstreamFailureStatus(429)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns true for 408 request timeout', () => {
  expect(isTransientUpstreamFailureStatus(408)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns false for 533 worker exhausted', () => {
  expect(isTransientUpstreamFailureStatus(533)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns false for 200 success', () => {
  expect(isTransientUpstreamFailureStatus(200)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns false for 404 not found', () => {
  expect(isTransientUpstreamFailureStatus(404)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns false for 403 forbidden', () => {
  expect(isTransientUpstreamFailureStatus(403)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns false for 400 bad request', () => {
  expect(isTransientUpstreamFailureStatus(400)).toBe(false);
});

test('isTransientUpstreamFailureStatus returns true for 600 start of 6xx range', () => {
  expect(isTransientUpstreamFailureStatus(600)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns true for 699 end of 6xx range', () => {
  expect(isTransientUpstreamFailureStatus(699)).toBe(true);
});

test('isTransientUpstreamFailureStatus returns false for 700 outside 6xx range', () => {
  expect(isTransientUpstreamFailureStatus(700)).toBe(false);
});

test('isCacheableStatus returns false for 600 6xx code', () => {
  expect(isCacheableStatus(600)).toBe(false);
});

test('isCacheableStatus returns false for 699 6xx code', () => {
  expect(isCacheableStatus(699)).toBe(false);
});
