// Response time tracking and EWMA health scoring for IP rotation
// Execute with bun: wrangler dev

// Interfaces at top
interface RecordResponseTimeParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly index: number;
  readonly responseTimeMs: number;
}

interface GetAdaptiveHedgeDelayParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly endpointCount: number;
  readonly defaultDelayMs: number;
}

interface UpdateHealthScoreParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly index: number;
  readonly isSuccess: boolean;
  readonly isThrottle?: boolean;
}

interface GetHealthScoreParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly index: number;
}

interface GetEndpointWeightsParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly endpointCount: number;
}

// Response time constants
const RT_KEY_PREFIX: string = 'rt';
const RT_POINTER_KEY_PREFIX: string = 'rtp';
const RT_WINDOW_SIZE: number = 10;
const PERCENTILE_P50: number = 50;
const HEDGE_DELAY_MIN_SAMPLES: number = 3;

// EWMA health scoring constants
const EWMA_KEY_PREFIX: string = 'ewma';
const EWMA_TS_KEY_PREFIX: string = 'ewmats';
const EWMA_HALF_LIFE_MS: number = 30000;
const EWMA_FAILURE_DELTA: number = 1.0;
const EWMA_SUCCESS_DELTA: number = -0.5;
const EWMA_THROTTLE_DELTA: number = 0.3;
const EWMA_MIN_SCORE: number = 0;

// Response time key builders
const buildRtSlotKey = (domain: string, index: number, slot: number): string =>
  `${RT_KEY_PREFIX}:${domain}:${index}:${slot}`;

const buildRtPointerKey = (domain: string, index: number): string =>
  `${RT_POINTER_KEY_PREFIX}:${domain}:${index}`;

// EWMA key builders
const buildEwmaScoreKey = (domain: string, index: number): string =>
  `${EWMA_KEY_PREFIX}:${domain}:${index}`;

const buildEwmaTsKey = (domain: string, index: number): string =>
  `${EWMA_TS_KEY_PREFIX}:${domain}:${index}`;

// Record a response time into the rolling window
const recordResponseTime = (params: RecordResponseTimeParams): void => {
  const pointerKey: string = buildRtPointerKey(params.domain, params.index);
  const currentSlot: number = (params.counters.get(pointerKey) ?? 0) % RT_WINDOW_SIZE;
  params.counters.set(
    buildRtSlotKey(params.domain, params.index, currentSlot),
    params.responseTimeMs,
  );
  params.counters.set(pointerKey, currentSlot + 1);
};

// Get all recorded response times for a single endpoint
const getEndpointResponseTimes = (
  counters: Map<string, number>,
  domain: string,
  index: number,
): readonly number[] =>
  Array.from({ length: RT_WINDOW_SIZE }, (_: unknown, slot: number) =>
    counters.get(buildRtSlotKey(domain, index, slot)),
  ).filter((v): v is number => v !== undefined);

// Number comparator for sorting
const numberAsc = (a: number, b: number): number => a - b;

// Calculate percentile from a list of values
const getPercentile = (values: readonly number[], percentile: number): number | null => {
  if (values.length === 0) return null;
  const sorted: readonly number[] = [...values].sort(numberAsc);
  const index: number = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted.at(index) ?? null;
};

// Get adaptive hedge delay based on P50 of response times across all endpoints
const getAdaptiveHedgeDelay = (params: GetAdaptiveHedgeDelayParams): number => {
  const allTimes: readonly number[] = Array.from(
    { length: params.endpointCount },
    (_: unknown, i: number) => getEndpointResponseTimes(params.counters, params.domain, i),
  ).flat();
  if (allTimes.length < HEDGE_DELAY_MIN_SAMPLES) return params.defaultDelayMs;
  return getPercentile(allTimes, PERCENTILE_P50) ?? params.defaultDelayMs;
};

// Apply EWMA decay to a score based on elapsed time
const decayScore = (score: number, elapsedMs: number): number =>
  Math.max(EWMA_MIN_SCORE, score * 0.5 ** (elapsedMs / EWMA_HALF_LIFE_MS));

// Get EWMA delta based on outcome type (avoids nested ternary - rule 27)
const getEwmaDelta = (isSuccess: boolean, isThrottle: boolean): number => {
  if (isThrottle) return EWMA_THROTTLE_DELTA;
  if (isSuccess) return EWMA_SUCCESS_DELTA;
  return EWMA_FAILURE_DELTA;
};

// Update EWMA health score for an endpoint (failure increases, success decreases)
const updateHealthScore = (params: UpdateHealthScoreParams): void => {
  const scoreKey: string = buildEwmaScoreKey(params.domain, params.index);
  const tsKey: string = buildEwmaTsKey(params.domain, params.index);
  const now: number = Date.now();
  const lastTs: number = params.counters.get(tsKey) ?? now;
  const currentScore: number = params.counters.get(scoreKey) ?? 0;
  const decayed: number = decayScore(currentScore, now - lastTs);
  const delta: number = getEwmaDelta(params.isSuccess, params.isThrottle ?? false);
  params.counters.set(scoreKey, Math.max(EWMA_MIN_SCORE, decayed + delta));
  params.counters.set(tsKey, now);
};

// Get current health score for an endpoint (with decay applied)
const getHealthScore = (params: GetHealthScoreParams): number => {
  const currentScore: number | undefined = params.counters.get(
    buildEwmaScoreKey(params.domain, params.index),
  );
  if (currentScore === undefined) return EWMA_MIN_SCORE;
  const lastTs: number =
    params.counters.get(buildEwmaTsKey(params.domain, params.index)) ?? Date.now();
  return decayScore(currentScore, Date.now() - lastTs);
};

// Convert health score to selection weight (lower score = higher weight)
const healthScoreToWeight = (score: number): number => 1 / (1 + score);

// Get selection weights for all endpoints based on health scores
const getEndpointWeights = (params: GetEndpointWeightsParams): readonly number[] =>
  Array.from({ length: params.endpointCount }, (_: unknown, i: number) =>
    healthScoreToWeight(
      getHealthScore({ counters: params.counters, domain: params.domain, index: i }),
    ),
  );

export {
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
  getEwmaDelta,
  getAdaptiveHedgeDelay,
  getEndpointResponseTimes,
  getEndpointWeights,
  getHealthScore,
  getPercentile,
  healthScoreToWeight,
  HEDGE_DELAY_MIN_SAMPLES,
  PERCENTILE_P50,
  recordResponseTime,
  RT_KEY_PREFIX,
  RT_POINTER_KEY_PREFIX,
  RT_WINDOW_SIZE,
  updateHealthScore,
};

export type {
  GetAdaptiveHedgeDelayParams,
  GetEndpointWeightsParams,
  GetHealthScoreParams,
  RecordResponseTimeParams,
  UpdateHealthScoreParams,
};
