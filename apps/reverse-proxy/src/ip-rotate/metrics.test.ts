// Tests for response time tracking metrics
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildEwmaScoreKey,
  buildEwmaTsKey,
  buildRtPointerKey,
  buildRtSlotKey,
  decayScore,
  EWMA_FAILURE_DELTA,
  EWMA_HALF_LIFE_MS,
  EWMA_KEY_PREFIX,
  EWMA_MIN_SCORE,
  EWMA_SUCCESS_DELTA,
  EWMA_THROTTLE_DELTA,
  EWMA_TS_KEY_PREFIX,
  getAdaptiveHedgeDelay,
  getEndpointResponseTimes,
  getEndpointWeights,
  getEwmaDelta,
  getHealthScore,
  getPercentile,
  HEDGE_DELAY_MIN_SAMPLES,
  healthScoreToWeight,
  PERCENTILE_P50,
  RT_KEY_PREFIX,
  RT_POINTER_KEY_PREFIX,
  RT_WINDOW_SIZE,
  recordResponseTime,
  updateHealthScore,
} from './metrics.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('RT_WINDOW_SIZE is 10', () => {
  expect(RT_WINDOW_SIZE).toBe(10);
});

test('PERCENTILE_P50 is 50', () => {
  expect(PERCENTILE_P50).toBe(50);
});

test('RT_KEY_PREFIX is rt', () => {
  expect(RT_KEY_PREFIX).toBe('rt');
});

test('RT_POINTER_KEY_PREFIX is rtp', () => {
  expect(RT_POINTER_KEY_PREFIX).toBe('rtp');
});

test('buildRtSlotKey formats correctly', () => {
  expect(buildRtSlotKey('example.com', 0, 3)).toBe('rt:example.com:0:3');
});

test('buildRtPointerKey formats correctly', () => {
  expect(buildRtPointerKey('example.com', 2)).toBe('rtp:example.com:2');
});

test('recordResponseTime writes to first slot when empty', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 150 });
  expect(counters.get('rt:example.com:0:0')).toBe(150);
  expect(counters.get('rtp:example.com:0')).toBe(1);
});

test('recordResponseTime writes to sequential slots', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  expect(counters.get('rt:example.com:0:0')).toBe(100);
  expect(counters.get('rt:example.com:0:1')).toBe(200);
  expect(counters.get('rt:example.com:0:2')).toBe(300);
  expect(counters.get('rtp:example.com:0')).toBe(3);
});

test('recordResponseTime wraps around after window size', () => {
  const counters: Map<string, number> = new Map();
  // Fill all 10 slots
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 400 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 500 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 600 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 700 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 800 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 900 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 1000 });
  // 11th write wraps to slot 0
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 50 });
  expect(counters.get('rt:example.com:0:0')).toBe(50);
  expect(counters.get('rt:example.com:0:1')).toBe(200);
  // Pointer wraps: slot 0 + 1 = 1
  expect(counters.get('rtp:example.com:0')).toBe(1);
});

test('recordResponseTime keeps separate slots per endpoint index', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 1, responseTimeMs: 200 });
  expect(counters.get('rt:example.com:0:0')).toBe(100);
  expect(counters.get('rt:example.com:1:0')).toBe(200);
  expect(counters.get('rtp:example.com:0')).toBe(1);
  expect(counters.get('rtp:example.com:1')).toBe(1);
});

test('getEndpointResponseTimes returns empty for no data', () => {
  const counters: Map<string, number> = new Map();
  const times: readonly number[] = getEndpointResponseTimes(counters, 'example.com', 0);
  expect(times).toStrictEqual([]);
});

test('getEndpointResponseTimes returns recorded values', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  const times: readonly number[] = getEndpointResponseTimes(counters, 'example.com', 0);
  expect(times).toStrictEqual([100, 200, 300]);
});

test('getEndpointResponseTimes returns full window after wrap', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 400 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 500 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 600 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 700 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 800 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 900 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 1000 });
  // Wrap around
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 50 });
  const times: readonly number[] = getEndpointResponseTimes(counters, 'example.com', 0);
  // Slot 0 was overwritten with 50, slots 1-9 still have 200-1000
  expect(times).toStrictEqual([50, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
});

test('getPercentile returns null for empty array', () => {
  expect(getPercentile([], 50)).toBeNull();
});

test('getPercentile returns single value for one element', () => {
  expect(getPercentile([100], 50)).toBe(100);
});

test('getPercentile computes P50 for even count', () => {
  expect(getPercentile([100, 200, 300, 400], 50)).toBe(200);
});

test('getPercentile computes P50 for odd count', () => {
  expect(getPercentile([100, 200, 300, 400, 500], 50)).toBe(300);
});

test('getPercentile sorts values before computing', () => {
  expect(getPercentile([500, 100, 300, 200, 400], 50)).toBe(300);
});

test('getPercentile computes P90', () => {
  expect(getPercentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 90)).toBe(900);
});

test('getPercentile computes P10', () => {
  expect(getPercentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 10)).toBe(100);
});

test('HEDGE_DELAY_MIN_SAMPLES is 3', () => {
  expect(HEDGE_DELAY_MIN_SAMPLES).toBe(3);
});

test('getAdaptiveHedgeDelay returns default with 1 sample below min', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 50 });
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 1,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(500);
});

test('getAdaptiveHedgeDelay returns default with 2 samples below min', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 50 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 1,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(500);
});

test('getAdaptiveHedgeDelay returns P50 with exactly min samples', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 1,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(200);
});

test('getAdaptiveHedgeDelay returns default when no data', () => {
  const counters: Map<string, number> = new Map();
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 3,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(500);
});

test('getAdaptiveHedgeDelay returns P50 across single endpoint', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 300 });
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 1,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(200);
});

test('getAdaptiveHedgeDelay aggregates across multiple endpoints', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 200 });
  recordResponseTime({ counters, domain: 'example.com', index: 1, responseTimeMs: 300 });
  recordResponseTime({ counters, domain: 'example.com', index: 1, responseTimeMs: 400 });
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 2,
    defaultDelayMs: 500,
  });
  // Values: [100, 200, 300, 400] sorted -> P50 = 200
  expect(delay).toBe(200);
});

test('getAdaptiveHedgeDelay returns default with sparse data below min samples', () => {
  const counters: Map<string, number> = new Map();
  recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 150 });
  // index 1 and 2 have no data, total samples = 1 < MIN_SAMPLES
  const delay: number = getAdaptiveHedgeDelay({
    counters,
    domain: 'example.com',
    endpointCount: 3,
    defaultDelayMs: 500,
  });
  expect(delay).toBe(500);
});

describe('getAdaptiveHedgeDelay with filled window', () => {
  test('uses recent values after wrap-around', () => {
    const counters: Map<string, number> = new Map();
    // Fill 10 slots with 100ms each
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 100 });
    // Overwrite first slot with 500ms
    recordResponseTime({ counters, domain: 'example.com', index: 0, responseTimeMs: 500 });
    const delay: number = getAdaptiveHedgeDelay({
      counters,
      domain: 'example.com',
      endpointCount: 1,
      defaultDelayMs: 999,
    });
    // Values: [500, 100, 100, 100, 100, 100, 100, 100, 100, 100] sorted -> P50 = 100
    expect(delay).toBe(100);
  });
});

// EWMA Health Scoring Tests
test('EWMA_HALF_LIFE_MS is 30000', () => {
  expect(EWMA_HALF_LIFE_MS).toBe(30000);
});

test('EWMA_FAILURE_DELTA is 1.0', () => {
  expect(EWMA_FAILURE_DELTA).toBe(1.0);
});

test('EWMA_SUCCESS_DELTA is -0.5', () => {
  expect(EWMA_SUCCESS_DELTA).toBe(-0.5);
});

test('EWMA_MIN_SCORE is 0', () => {
  expect(EWMA_MIN_SCORE).toBe(0);
});

test('EWMA_KEY_PREFIX is ewma', () => {
  expect(EWMA_KEY_PREFIX).toBe('ewma');
});

test('EWMA_TS_KEY_PREFIX is ewmats', () => {
  expect(EWMA_TS_KEY_PREFIX).toBe('ewmats');
});

test('buildEwmaScoreKey formats correctly', () => {
  expect(buildEwmaScoreKey('example.com', 0)).toBe('ewma:example.com:0');
});

test('buildEwmaTsKey formats correctly', () => {
  expect(buildEwmaTsKey('example.com', 2)).toBe('ewmats:example.com:2');
});

test('decayScore returns 0 for 0 score', () => {
  expect(decayScore(0, 30000)).toBe(0);
});

test('decayScore halves score after one half-life', () => {
  expect(decayScore(2.0, 30000)).toBeCloseTo(1.0, 5);
});

test('decayScore quarters score after two half-lives', () => {
  expect(decayScore(4.0, 60000)).toBeCloseTo(1.0, 5);
});

test('decayScore returns original score with 0 elapsed', () => {
  expect(decayScore(3.0, 0)).toBe(3.0);
});

test('decayScore approaches zero after many half-lives', () => {
  expect(decayScore(0.001, 1000000)).toBeLessThan(0.0000001);
});

test('updateHealthScore records failure score', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  expect(counters.get('ewma:example.com:0')).toBe(1.0);
  expect(counters.get('ewmats:example.com:0')).toBe(Date.now());
});

test('updateHealthScore accumulates failures', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // 1.0 + 1.0 = 2.0 (no decay since same timestamp)
  expect(counters.get('ewma:example.com:0')).toBe(2.0);
});

test('updateHealthScore success reduces score', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: true });
  // 1.0 + (-0.5) = 0.5
  expect(counters.get('ewma:example.com:0')).toBe(0.5);
});

test('updateHealthScore clamps to 0 on excessive success', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: true });
  // 0 + (-0.5) = -0.5 clamped to 0
  expect(counters.get('ewma:example.com:0')).toBe(0);
});

test('updateHealthScore applies decay over time', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // Score is 1.0 at t=0, advance 30s (one half-life)
  vi.advanceTimersByTime(30000);
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // decayed(1.0, 30000) = 0.5, + 1.0 = 1.5
  expect(counters.get('ewma:example.com:0')).toBeCloseTo(1.5, 5);
});

test('updateHealthScore decays nearly to zero after long time', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // Advance 5 minutes (10 half-lives)
  vi.advanceTimersByTime(300000);
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // decayed(1.0, 300000) ~= 0.001, + 1.0 ~= 1.001
  const score: number | undefined = counters.get('ewma:example.com:0');
  expect(score).toBeGreaterThan(1.0);
  expect(score).toBeLessThan(1.01);
});

test('getHealthScore returns 0 for unknown endpoint', () => {
  const counters: Map<string, number> = new Map();
  expect(getHealthScore({ counters, domain: 'example.com', index: 0 })).toBe(0);
});

test('getHealthScore returns decayed current score', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // Score is 2.0 at t=0
  vi.advanceTimersByTime(30000);
  // After one half-life, decayed to 1.0
  expect(getHealthScore({ counters, domain: 'example.com', index: 0 })).toBeCloseTo(1.0, 5);
});

test('healthScoreToWeight returns 1 for score 0', () => {
  expect(healthScoreToWeight(0)).toBe(1);
});

test('healthScoreToWeight returns 0.5 for score 1', () => {
  expect(healthScoreToWeight(1)).toBe(0.5);
});

test('healthScoreToWeight returns 0.25 for score 3', () => {
  expect(healthScoreToWeight(3)).toBe(0.25);
});

test('getEndpointWeights returns uniform weights with no data', () => {
  const counters: Map<string, number> = new Map();
  const weights: readonly number[] = getEndpointWeights({
    counters,
    domain: 'example.com',
    endpointCount: 3,
  });
  expect(weights).toStrictEqual([1, 1, 1]);
});

test('getEndpointWeights reflects health scores', () => {
  const counters: Map<string, number> = new Map();
  // Endpoint 0: 2 failures -> score 2.0
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  updateHealthScore({ counters, domain: 'example.com', index: 0, isSuccess: false });
  // Endpoint 1: no failures -> score 0
  // Endpoint 2: 1 failure -> score 1.0
  updateHealthScore({ counters, domain: 'example.com', index: 2, isSuccess: false });
  const weights: readonly number[] = getEndpointWeights({
    counters,
    domain: 'example.com',
    endpointCount: 3,
  });
  // weight(0) = 1/(1+2) = 0.333, weight(1) = 1/(1+0) = 1.0, weight(2) = 1/(1+1) = 0.5
  expect(weights.at(0)).toBeCloseTo(0.333, 2);
  expect(weights.at(1)).toBe(1);
  expect(weights.at(2)).toBe(0.5);
});

// EWMA throttle delta tests
test('EWMA_THROTTLE_DELTA is 0.3', () => {
  expect(EWMA_THROTTLE_DELTA).toBe(0.3);
});

test('getEwmaDelta returns EWMA_THROTTLE_DELTA for throttle', () => {
  expect(getEwmaDelta(false, true)).toBe(0.3);
});

test('getEwmaDelta returns EWMA_SUCCESS_DELTA for success', () => {
  expect(getEwmaDelta(true, false)).toBe(-0.5);
});

test('getEwmaDelta returns EWMA_FAILURE_DELTA for failure', () => {
  expect(getEwmaDelta(false, false)).toBe(1.0);
});

test('getEwmaDelta prioritizes throttle over success', () => {
  expect(getEwmaDelta(true, true)).toBe(0.3);
});

test('updateHealthScore applies throttle penalty of 0.3', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({
    counters,
    domain: 'example.com',
    index: 0,
    isSuccess: false,
    isThrottle: true,
  });
  expect(counters.get('ewma:example.com:0')).toBe(0.3);
  expect(counters.get('ewmats:example.com:0')).toBe(Date.now());
});

test('updateHealthScore accumulates throttle penalties', () => {
  const counters: Map<string, number> = new Map();
  updateHealthScore({
    counters,
    domain: 'example.com',
    index: 0,
    isSuccess: false,
    isThrottle: true,
  });
  updateHealthScore({
    counters,
    domain: 'example.com',
    index: 0,
    isSuccess: false,
    isThrottle: true,
  });
  // 0.3 + 0.3 = 0.6
  expect(counters.get('ewma:example.com:0')).toBeCloseTo(0.6, 5);
});

test('updateHealthScore throttle penalty is less than failure penalty', () => {
  const throttleCounters: Map<string, number> = new Map();
  updateHealthScore({
    counters: throttleCounters,
    domain: 'example.com',
    index: 0,
    isSuccess: false,
    isThrottle: true,
  });
  const failureCounters: Map<string, number> = new Map();
  updateHealthScore({
    counters: failureCounters,
    domain: 'example.com',
    index: 0,
    isSuccess: false,
  });
  const throttleScore: number = throttleCounters.get('ewma:example.com:0') ?? 0;
  const failureScore: number = failureCounters.get('ewma:example.com:0') ?? 0;
  expect(throttleScore).toBeLessThan(failureScore);
});
