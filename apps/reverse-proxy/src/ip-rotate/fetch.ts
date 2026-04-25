// IP Rotation fetch with authentication
// Execute with bun: wrangler dev
// SECURITY: Auth headers are for API Gateway only, NOT passed to target server
// API Gateway consumes x-api-key and IAM signature headers before forwarding

import {
  CACHE_MODE_NO_STORE,
  HEADER_ACCEPT_ENCODING,
  REDIRECT_MANUAL,
} from '../proxy/constants.ts';
import { isAkamaiBlockedResponse } from '../proxy/fetch/akamai.ts';
import {
  buildRewrittenUrl,
  getEndpointCount,
  getEndpointList,
  selectRegionAwareEndpoint,
} from './client.ts';
import {
  getAdaptiveHedgeDelay,
  getEndpointWeights,
  recordResponseTime,
  updateHealthScore,
} from './metrics.ts';
import { signRequest } from './signer.ts';
import type {
  EndpointOutcome,
  EndpointWithApiKey,
  FetchRetryErrorCode,
  FetchRetryResult,
  FetchWithAuthParams,
  FetchWithRetryParams,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
  RegionAwareEndpointResult,
  TimeoutConfig,
} from './types.ts';

// Interfaces at top
interface RecordEndpointFailureParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly urlHash: string;
  readonly index: number;
}

interface GetRecentlyFailedParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly urlHash: string;
  readonly endpointCount: number;
  readonly healthTtlMs?: number;
}

interface RecordEndpointThrottleParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly index: number;
}

interface GetRecentlyThrottledParams {
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly endpointCount: number;
  readonly throttleTtlMs?: number;
}

interface ResolvedTuning {
  readonly healthTtlMs: number;
  readonly maxHedgeAttempts: number;
  readonly hedgeDelayMs: number;
  readonly throttleBaseDelayMs: number;
  readonly throttleTtlMs: number;
  readonly hedgeSuppressThreshold: number;
}

interface RegionAwareRetryState {
  readonly params: FetchWithRetryParams;
  readonly endpoints: readonly EndpointWithApiKey[];
  readonly attempt: number;
  readonly maxRetries: number;
  readonly lastResponse: Response | null;
  readonly lastUsedEndpoint: string | null;
  readonly currentTimeoutMs: number;
  readonly timeoutConfig: TimeoutConfig;
  readonly triedRegions: Set<string>;
  readonly triedEndpointIndices: Set<number>;
  readonly serverErrorEndpoints: Set<number>;
  readonly wallClockSignal?: AbortSignal;
  readonly consecutiveThrottles: number;
  readonly hedgeAttemptsUsed: number;
  readonly tuning: ResolvedTuning;
  readonly urlHash: string;
}

interface FetchAttemptResult {
  readonly response: Response | null;
  readonly timedOut: boolean;
  readonly usedEndpoint: string;
}

interface HedgedFetchResult {
  readonly result: FetchAttemptResult;
  readonly selected: RegionAwareEndpointResult;
  readonly hedgeStarted: boolean;
}

interface HedgeRaceEntry {
  readonly result: FetchAttemptResult;
  readonly isPrimary: boolean;
}

interface HedgeRaceContext {
  readonly primaryAbort: AbortController;
  readonly hedgeAbort: AbortController;
  readonly primaryPromise: Promise<FetchAttemptResult>;
  readonly hedgePromise: Promise<FetchAttemptResult>;
}

interface RaceHedgeFetchesParams {
  readonly state: RegionAwareRetryState;
  readonly primarySelected: RegionAwareEndpointResult;
  readonly hedgeSelected: RegionAwareEndpointResult;
  readonly primaryAbort: AbortController;
  readonly primaryPromise: Promise<FetchAttemptResult>;
}

// Constants at top
const ACCEPT_ENCODING_IDENTITY: string = 'identity';
const HEADER_API_KEY: string = 'x-api-key';
const AUTH_TYPE_API_KEY = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const ERROR_INVALID_AUTH_TYPE: string = 'Invalid auth type';
const ERROR_UNSUPPORTED_AUTH_TYPE: string = 'Unsupported auth type';
const ERROR_REQUEST_TIMEOUT: string = 'Request timed out';

// Timeout constants
const ENV_DEFAULT_TIMEOUT: string = 'DEFAULT_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS: number = 2000;
const MIN_TIMEOUT_MS: number = 2000;
const MAX_TIMEOUT_MS: number = 8000;
// biome-ignore lint/nursery/noSecrets: TimeoutError is a standard error name, not a secret
const TIMEOUT_ERROR_NAME: string = 'TimeoutError';
const ABORT_ERROR_NAME: string = 'AbortError';
const TYPE_ERROR_NAME: string = 'TypeError';
const TIMEOUT_MESSAGE_PATTERN: RegExp = /timeout/i;

// Retry logic constants
const STATUS_SERVER_ERROR_START: number = 500;
const STATUS_TOO_MANY_REQUESTS: number = 429;
const STATUS_REQUEST_TIMEOUT: number = 408;
const STATUS_WORKER_RESOURCE_EXHAUSTED: number = 533;
const STATUS_EXTENDED_ERROR_END: number = 700;
// AWS API Gateway returns 400 Bad Request when its per-region throttle is
// exceeded under burst load. The upstream URL itself is well-formed, so
// retrying via a different IP-rotate endpoint usually succeeds.
const STATUS_BAD_REQUEST: number = 400;
const MIN_RETRIES: number = 5;
const ABSOLUTE_MAX_RETRIES: number = 20;
const ERROR_ALL_ENDPOINTS_FAILED: string = 'All endpoints failed';
const ERROR_NO_ENDPOINTS_AVAILABLE: string = 'No endpoints available for domain';
const ERROR_WALL_CLOCK_TIMEOUT: string = 'Wall clock timeout exceeded';

// G-1: Health tracking constants
const HEALTH_TTL_MS: number = 60000;
const HEALTH_KEY_PREFIX: string = '5xx';

// G-2: Retry budget extension constants
const EXTRA_RETRIES_PER_BLACKLIST: number = 2;
const MAX_RETRIES_MULTIPLIER: number = 3;

// G-3: Timeout boost constant
const TIMEOUT_BOOST_PER_BLACKLIST_MS: number = 500;

// Hedge request constants
const DEFAULT_HEDGE_DELAY_MS: number = 500;
const MAX_HEDGE_ATTEMPTS: number = 2;
const HEDGE_ATTEMPT_COST: number = 2;

// Throttle backoff constants
const THROTTLE_BASE_DELAY_MS: number = 100;
const THROTTLE_MAX_DELAY_MS: number = 1000;
const THROTTLE_BACKOFF_MULTIPLIER: number = 2;
const THROTTLE_JITTER_RATIO: number = 0.3;

// Throttle tracking constants
const THROTTLE_TTL_MS: number = 10000;
const THROTTLE_KEY_PREFIX: string = '429';

// Hedge suppression constants
const HEDGE_SUPPRESS_THRESHOLD: number = 3;

// Parse positive integer from env var with fallback
const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed: number = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

// Resolve tuning parameters from env vars with hardcoded fallbacks
const resolveTuning = (params: FetchWithRetryParams): ResolvedTuning => ({
  healthTtlMs: parsePositiveIntEnv(params.envHealthTtlMs, HEALTH_TTL_MS),
  maxHedgeAttempts: parsePositiveIntEnv(params.envMaxHedgeAttempts, MAX_HEDGE_ATTEMPTS),
  hedgeDelayMs: parsePositiveIntEnv(params.envHedgeDelayMs, DEFAULT_HEDGE_DELAY_MS),
  throttleBaseDelayMs: parsePositiveIntEnv(params.envThrottleBaseDelayMs, THROTTLE_BASE_DELAY_MS),
  throttleTtlMs: parsePositiveIntEnv(params.envThrottleTtlMs, THROTTLE_TTL_MS),
  hedgeSuppressThreshold: parsePositiveIntEnv(
    params.envHedgeSuppressThreshold,
    HEDGE_SUPPRESS_THRESHOLD,
  ),
});

// Timeout configuration
const defaultTimeoutConfig: TimeoutConfig = {
  defaultMs: DEFAULT_TIMEOUT_MS,
  minMs: MIN_TIMEOUT_MS,
  maxMs: MAX_TIMEOUT_MS,
} satisfies TimeoutConfig;

// Timeout helper functions
const parseEnvTimeout = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed: number = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const getDefaultTimeoutFromEnv = (envValue: string | undefined): number => {
  const parsed: number | null = parseEnvTimeout(envValue);
  return parsed ?? DEFAULT_TIMEOUT_MS;
};

const clampTimeout = (timeout: number, config: TimeoutConfig): number =>
  Math.min(Math.max(timeout, config.minMs), config.maxMs);

const createAbortSignal = (timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs);

// Throttle backoff helpers
const calculateThrottleDelay = (
  consecutiveThrottles: number,
  baseDelayMs: number = THROTTLE_BASE_DELAY_MS,
): number => {
  const baseDelay: number = Math.min(
    baseDelayMs * THROTTLE_BACKOFF_MULTIPLIER ** consecutiveThrottles,
    THROTTLE_MAX_DELAY_MS,
  );
  const jitterRange: number = Math.floor(baseDelay * THROTTLE_JITTER_RATIO);
  const jitter: number = Math.floor(Math.random() * jitterRange);
  return baseDelay + jitter;
};

const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Type for auth handler function
type AuthHandler = (params: FetchWithAuthParams) => Promise<Response>;

// Pure functions - Auth headers are ONLY for API Gateway, target receives original headers
const createApiKeyAuthHeaders = (
  baseHeaders: Record<string, string>,
  apiKey: string,
): Record<string, string> => ({
  ...baseHeaders,
  [HEADER_API_KEY]: apiKey,
});

// Force identity encoding to prevent API Gateway from corrupting compressed responses
const stripCompressionEncoding = (headers: Record<string, string>): Record<string, string> => ({
  ...headers,
  [HEADER_ACCEPT_ENCODING]: ACCEPT_ENCODING_IDENTITY,
});

const isApiKeyAuth = (auth: IpRotateAuth): auth is IpRotateAuthApiKey =>
  auth.type === AUTH_TYPE_API_KEY;

const isIamAuth = (auth: IpRotateAuth): auth is IpRotateAuthIam => auth.type === AUTH_TYPE_IAM;

const fetchWithApiKey = async (params: FetchWithAuthParams): Promise<Response> => {
  if (!isApiKeyAuth(params.auth)) {
    throw new Error(ERROR_INVALID_AUTH_TYPE);
  }
  // x-api-key is consumed by API Gateway, not forwarded to target
  const gatewayHeaders: Record<string, string> = createApiKeyAuthHeaders(
    stripCompressionEncoding(params.headers),
    params.auth.apiKey,
  );
  return await globalThis.fetch(params.url.toString(), {
    method: params.method,
    headers: gatewayHeaders,
    body: params.body,
    signal: params.signal,
    redirect: REDIRECT_MANUAL,
    cache: CACHE_MODE_NO_STORE,
  });
};

const fetchWithIam = async (params: FetchWithAuthParams): Promise<Response> => {
  if (!isIamAuth(params.auth)) {
    throw new Error(ERROR_INVALID_AUTH_TYPE);
  }
  // IAM signature headers are consumed by API Gateway, not forwarded to target
  const signed = await signRequest({
    url: params.url,
    method: params.method,
    headers: stripCompressionEncoding(params.headers),
    body: params.body,
    auth: params.auth,
  });
  return globalThis.fetch(signed.url, {
    method: params.method,
    headers: signed.headers,
    body: params.body,
    signal: params.signal,
    redirect: REDIRECT_MANUAL,
    cache: CACHE_MODE_NO_STORE,
  });
};

// Auth handler map using object instead of Map for compliance
const authHandlers: Record<string, AuthHandler> = {
  [AUTH_TYPE_API_KEY]: fetchWithApiKey,
  [AUTH_TYPE_IAM]: fetchWithIam,
};

const fetchWithAuth = async (params: FetchWithAuthParams): Promise<Response> => {
  const handler: AuthHandler | undefined = authHandlers[params.auth.type];
  if (!handler) {
    throw new Error(`${ERROR_UNSUPPORTED_AUTH_TYPE}: ${params.auth.type}`);
  }
  return await handler(params);
};

// Helper functions for retry logic
// Retry for 5xx server errors, 6xx non-standard upstream/proxy codes
// (e.g. 660 emitted by some infrastructure), 429 rate limit, 408 request
// timeout, and 400 Bad Request (AWS API Gateway burst-throttle rejection).
// 533 (Cloudflare Worker resource exhausted) is NOT retried because
// rotating IPs cannot fix a local Worker constraint.
const isRetriableStatus = (status: number): boolean => {
  if (status === STATUS_WORKER_RESOURCE_EXHAUSTED) return false;
  if (status >= STATUS_SERVER_ERROR_START && status < STATUS_EXTENDED_ERROR_END) return true;
  if (status === STATUS_TOO_MANY_REQUESTS) return true;
  if (status === STATUS_REQUEST_TIMEOUT) return true;
  if (status === STATUS_BAD_REQUEST) return true;
  return false;
};

// Emit a per-endpoint outcome callback if the caller supplied one. Used by the
// proxy layer to forward each attempt's result to the Durable Object so
// failures on specific endpoints are remembered across Worker instances.
const emitEndpointOutcome = (params: FetchWithRetryParams, outcome: EndpointOutcome): void => {
  if (!params.onEndpointOutcome) return;
  try {
    params.onEndpointOutcome(outcome);
  } catch {
    // Never let outcome reporting break the retry loop
  }
};

// Treat 5xx and 6xx (non-standard upstream codes) as server-side errors for
// retry handler classification.
const isServerErrorStatus = (status: number): boolean =>
  status >= STATUS_SERVER_ERROR_START && status < STATUS_EXTENDED_ERROR_END;

const calculateMaxRetries = (endpointCount: number): number =>
  Math.min(Math.max(endpointCount, MIN_RETRIES), ABSOLUTE_MAX_RETRIES);

const createSuccessResult = (response: Response, usedEndpoint: string): FetchRetryResult => ({
  success: true,
  response,
  usedEndpoint,
});

interface CreateFailureParams {
  readonly lastResponse: Response | null;
  readonly lastUsedEndpoint: string | null;
  readonly error: string;
  readonly errorCode: FetchRetryErrorCode;
  readonly totalAttempts: number;
}

const createFailureResult = (params: CreateFailureParams): FetchRetryResult => ({
  success: false,
  lastResponse: params.lastResponse,
  lastUsedEndpoint: params.lastUsedEndpoint,
  error: params.error,
  errorCode: params.errorCode,
  totalAttempts: params.totalAttempts,
});

const createAuthFromEndpoint = (baseAuth: IpRotateAuth, endpointApiKey: string): IpRotateAuth => {
  // If base auth is api-key type, use the endpoint-specific API key
  if (isApiKeyAuth(baseAuth)) {
    return { type: AUTH_TYPE_API_KEY, apiKey: endpointApiKey };
  }
  // For IAM auth, continue using the base auth (credentials are global)
  return baseAuth;
};

// G-1: Health tracking functions
// Keys are scoped per (domain, urlHash, endpoint index) so a 5xx/6xx failure
// on endpoint #N for URL X only prevents endpoint #N from being picked again
// for URL X within the TTL window; other URLs can still use endpoint #N and
// the pool of available endpoints per-URL grows compared to a blanket
// domain-level blacklist.
const buildHealthKey = (domain: string, urlHash: string, index: number): string =>
  `${HEALTH_KEY_PREFIX}:${domain}:${urlHash}:${index}`;

// FNV-1a 32-bit string hash. Used to derive a compact per-URL suffix for the
// (domain, urlHash, index) blacklist key so the DO/KV does not grow with full
// URL strings. Same URL -> same hash, so subsequent requests see prior
// failures.
const URL_HASH_BASIS: number = 0x811c9dc5;
const URL_HASH_PRIME: number = 0x01000193;
const URL_HASH_HEX_WIDTH: number = 8;

const hashUrl = (value: string): string => {
  const hash: number = Array.from(value).reduce((acc: number, ch: string): number => {
    const xored: number = acc ^ ch.charCodeAt(0);
    return Math.imul(xored, URL_HASH_PRIME) >>> 0;
  }, URL_HASH_BASIS);
  return hash.toString(16).padStart(URL_HASH_HEX_WIDTH, '0');
};

const recordEndpointFailure = (params: RecordEndpointFailureParams): void => {
  params.counters.set(buildHealthKey(params.domain, params.urlHash, params.index), Date.now());
};

const getRecentlyFailedIndices = (params: GetRecentlyFailedParams): Set<number> => {
  const now: number = Date.now();
  const ttl: number = params.healthTtlMs ?? HEALTH_TTL_MS;
  return new Set(
    Array.from({ length: params.endpointCount }, (_: unknown, i: number) => i).filter(
      (i: number) => {
        const lastFailure: number | undefined = params.counters.get(
          buildHealthKey(params.domain, params.urlHash, i),
        );
        return lastFailure !== undefined && now - lastFailure < ttl;
      },
    ),
  );
};

// Throttle tracking functions
const buildThrottleKey = (domain: string, index: number): string =>
  `${THROTTLE_KEY_PREFIX}:${domain}:${index}`;

const recordEndpointThrottle = (params: RecordEndpointThrottleParams): void => {
  params.counters.set(buildThrottleKey(params.domain, params.index), Date.now());
};

const getRecentlyThrottledIndices = (params: GetRecentlyThrottledParams): Set<number> => {
  const now: number = Date.now();
  const ttl: number = params.throttleTtlMs ?? THROTTLE_TTL_MS;
  return new Set(
    Array.from({ length: params.endpointCount }, (_: unknown, i: number) => i).filter(
      (i: number) => {
        const lastThrottle: number | undefined = params.counters.get(
          buildThrottleKey(params.domain, i),
        );
        return lastThrottle !== undefined && now - lastThrottle < ttl;
      },
    ),
  );
};

// Hedge suppression: suppress when too many endpoints are throttled
const shouldSuppressHedge = (state: RegionAwareRetryState): boolean =>
  getRecentlyThrottledIndices({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    endpointCount: state.endpoints.length,
    throttleTtlMs: state.tuning.throttleTtlMs,
  }).size >= state.tuning.hedgeSuppressThreshold;

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.name === TIMEOUT_ERROR_NAME;

const isRetriableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === TIMEOUT_ERROR_NAME) return true;
  if (error.name === ABORT_ERROR_NAME && TIMEOUT_MESSAGE_PATTERN.test(error.message)) return true;
  if (error.name === TYPE_ERROR_NAME) return true;
  return false;
};

const tryRegionAwareFetch = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
  extraAbortSignal?: AbortSignal,
): Promise<FetchAttemptResult> => {
  const rewrittenUrl: URL = buildRewrittenUrl(selected.endpoint.endpoint, state.params.targetUrl);
  const usedEndpoint: string = rewrittenUrl.origin;
  const auth: IpRotateAuth = createAuthFromEndpoint(
    state.params.config.auth,
    selected.endpoint.apiKey,
  );

  try {
    const perAttemptSignal: AbortSignal = createAbortSignal(state.currentTimeoutMs);
    const signal: AbortSignal = AbortSignal.any(
      [perAttemptSignal, state.wallClockSignal, extraAbortSignal].filter(
        (s): s is AbortSignal => s !== undefined,
      ),
    );
    const startTime: number = Date.now();
    const response: Response = await fetchWithAuth({
      url: rewrittenUrl,
      auth,
      headers: state.params.headers,
      method: state.params.method,
      body: state.params.body,
      signal,
    });
    recordResponseTime({
      counters: state.params.counters,
      domain: state.params.targetUrl.host,
      index: selected.index,
      responseTimeMs: Date.now() - startTime,
    });
    return { response, timedOut: false, usedEndpoint };
  } catch (error: unknown) {
    // In hedge mode, treat all AbortErrors as retriable (hedge race loser or wallClock)
    if (extraAbortSignal && error instanceof Error && error.name === ABORT_ERROR_NAME) {
      return { response: null, timedOut: true, usedEndpoint };
    }
    if (isRetriableError(error)) {
      return { response: null, timedOut: true, usedEndpoint };
    }
    throw error;
  }
};

// Reset blacklisted endpoints into triedEndpointIndices after round-robin reset
const reapplyBlacklist = (state: RegionAwareRetryState): void => {
  for (const index of state.serverErrorEndpoints) {
    state.triedEndpointIndices.add(index);
  }
};

// G-3: Calculate boosted timeout based on blacklisted endpoint count
const calculateBoostedTimeout = (state: RegionAwareRetryState): number =>
  state.serverErrorEndpoints.size > 0
    ? clampTimeout(
        state.currentTimeoutMs + TIMEOUT_BOOST_PER_BLACKLIST_MS * state.serverErrorEndpoints.size,
        state.timeoutConfig,
      )
    : state.currentTimeoutMs;

// Handle round-robin reset when all endpoints have been tried
const handleRoundRobinReset = (state: RegionAwareRetryState): Promise<FetchRetryResult> => {
  state.triedEndpointIndices.clear();
  state.triedRegions.clear();
  reapplyBlacklist(state);

  const boostedTimeout: number = calculateBoostedTimeout(state);
  const retrySelected: RegionAwareEndpointResult | null = selectEndpointWithWeights(state);
  if (!retrySelected) {
    return Promise.resolve(
      createFailureResult({
        lastResponse: state.lastResponse,
        lastUsedEndpoint: state.lastUsedEndpoint,
        error: ERROR_ALL_ENDPOINTS_FAILED,
        errorCode: 'MAX_RETRIES',
        totalAttempts: state.attempt,
      }),
    );
  }
  return regionAwareRetryAttemptWithSelected(
    { ...state, currentTimeoutMs: boostedTimeout },
    retrySelected,
  );
};

// Select endpoint with EWMA-based health weights
const selectEndpointWithWeights = (
  state: RegionAwareRetryState,
): RegionAwareEndpointResult | null =>
  selectRegionAwareEndpoint({
    endpoints: state.endpoints,
    triedRegions: state.triedRegions,
    triedEndpointIndices: state.triedEndpointIndices,
    endpointWeights: getEndpointWeights({
      counters: state.params.counters,
      domain: state.params.targetUrl.host,
      endpointCount: state.endpoints.length,
    }),
  });

const regionAwareRetryAttempt = (state: RegionAwareRetryState): Promise<FetchRetryResult> => {
  if (state.wallClockSignal?.aborted) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log('[ip-rotate]', { event: 'wall-clock-timeout', attempt: state.attempt });
    return Promise.resolve(
      createFailureResult({
        lastResponse: state.lastResponse,
        lastUsedEndpoint: state.lastUsedEndpoint,
        error: ERROR_WALL_CLOCK_TIMEOUT,
        errorCode: 'WALL_CLOCK_TIMEOUT',
        totalAttempts: state.attempt,
      }),
    );
  }

  if (state.attempt >= state.maxRetries) {
    return Promise.resolve(
      createFailureResult({
        lastResponse: state.lastResponse,
        lastUsedEndpoint: state.lastUsedEndpoint,
        error: ERROR_ALL_ENDPOINTS_FAILED,
        errorCode: 'MAX_RETRIES',
        totalAttempts: state.attempt,
      }),
    );
  }

  const selected: RegionAwareEndpointResult | null = selectEndpointWithWeights(state);

  if (!selected) {
    return handleRoundRobinReset(state);
  }

  return regionAwareRetryAttemptWithSelected(state, selected);
};

// Handle timeout branch of retry attempt
const handleTimeoutRetry = (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
  result: FetchAttemptResult,
): Promise<FetchRetryResult> => {
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', {
    event: 'retry',
    attempt: state.attempt,
    endpoint: result.usedEndpoint,
    reason: 'timeout',
  });
  // G-4: Record timeout for cross-request deprioritization
  recordEndpointFailure({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    urlHash: state.urlHash,
    index: selected.index,
  });
  updateHealthScore({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    index: selected.index,
    isSuccess: false,
  });
  return regionAwareRetryAttempt({
    ...state,
    attempt: state.attempt + 1,
    lastUsedEndpoint: result.usedEndpoint,
    consecutiveThrottles: 0,
  });
};

// Handle 5xx server error branch of retry attempt
const handleServerErrorRetry = (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
  result: FetchAttemptResult,
): Promise<FetchRetryResult> => {
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', {
    event: 'retry',
    attempt: state.attempt,
    endpoint: result.usedEndpoint,
    reason: 'server-error',
    status: result.response?.status,
  });
  state.serverErrorEndpoints.add(selected.index);
  // G-1: Record failure scoped to (domain, urlHash, index) so the same URL
  // will avoid this endpoint next time, while other URLs can still use it.
  recordEndpointFailure({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    urlHash: state.urlHash,
    index: selected.index,
  });
  updateHealthScore({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    index: selected.index,
    isSuccess: false,
  });
  emitEndpointOutcome(state.params, {
    index: selected.index,
    endpoint: result.usedEndpoint,
    status: result.response?.status,
    urlHash: state.urlHash,
    isSuccess: false,
    isThrottle: false,
    isServerError: true,
  });
  // G-2: Extend retry budget
  const extendedMaxRetries: number = Math.min(
    state.maxRetries + EXTRA_RETRIES_PER_BLACKLIST,
    state.endpoints.length * MAX_RETRIES_MULTIPLIER,
    ABSOLUTE_MAX_RETRIES,
  );
  return regionAwareRetryAttempt({
    ...state,
    attempt: state.attempt + 1,
    lastResponse: result.response,
    lastUsedEndpoint: result.usedEndpoint,
    maxRetries: extendedMaxRetries,
    consecutiveThrottles: 0,
  });
};

// Handle 429 throttled branch of retry attempt
const handleThrottledRetry = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
  result: FetchAttemptResult,
): Promise<FetchRetryResult> => {
  const domain: string = state.params.targetUrl.host;
  // Record throttle for cross-request deprioritization
  recordEndpointThrottle({
    counters: state.params.counters,
    domain,
    index: selected.index,
  });
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', {
    event: 'endpoint-throttled',
    domain,
    index: selected.index,
    endpoint: result.usedEndpoint,
  });
  updateHealthScore({
    counters: state.params.counters,
    domain,
    index: selected.index,
    isSuccess: false,
    isThrottle: true,
  });
  emitEndpointOutcome(state.params, {
    index: selected.index,
    endpoint: result.usedEndpoint,
    status: result.response?.status,
    urlHash: state.urlHash,
    isSuccess: false,
    isThrottle: true,
    isServerError: false,
  });
  const throttleDelay: number = calculateThrottleDelay(
    state.consecutiveThrottles,
    state.tuning.throttleBaseDelayMs,
  );
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', {
    event: 'retry',
    attempt: state.attempt,
    endpoint: result.usedEndpoint,
    reason: 'throttled',
    delayMs: throttleDelay,
  });
  await waitMs(throttleDelay);
  return regionAwareRetryAttempt({
    ...state,
    attempt: state.attempt + 1,
    lastResponse: result.response,
    lastUsedEndpoint: result.usedEndpoint,
    consecutiveThrottles: state.consecutiveThrottles + 1,
  });
};

// Dynamic hedge policy: scale the hedge budget with retry attempts.
//   attempt 0-1 : allow at most 1 hedge (classic single hedged fallback).
//   attempt >= 2: allow up to the configured maximum.
// We NEVER exceed configuredMax so "scatter-mode" (N parallel requests from
// the first attempt) stays forbidden.
const HEDGE_ATTEMPT_FULL_BUDGET_THRESHOLD: number = 2;
const HEDGE_ATTEMPT_INITIAL_CAP: number = 1;
const HEDGE_DELAY_MIN_MS: number = 200;
const HEDGE_DELAY_STEP_MS: number = 50;

const computeDynamicHedgeCap = (attempt: number, configuredMax: number): number => {
  if (configuredMax <= 0) return 0;
  if (attempt < HEDGE_ATTEMPT_FULL_BUDGET_THRESHOLD) {
    return Math.min(HEDGE_ATTEMPT_INITIAL_CAP, configuredMax);
  }
  return configuredMax;
};

// Shrink hedge delay as retries accumulate so later attempts hedge sooner
// when the primary is still slow.
const computeDynamicHedgeDelayMs = (attempt: number, configuredDelayMs: number): number => {
  const reduced: number = configuredDelayMs - attempt * HEDGE_DELAY_STEP_MS;
  return Math.max(HEDGE_DELAY_MIN_MS, reduced);
};

// Hedge eligibility check
const isHedgeEligible = (state: RegionAwareRetryState): boolean => {
  const dynamicCap: number = computeDynamicHedgeCap(state.attempt, state.tuning.maxHedgeAttempts);
  if (
    state.hedgeAttemptsUsed >= dynamicCap ||
    state.attempt + HEDGE_ATTEMPT_COST > state.maxRetries
  ) {
    return false;
  }
  if (shouldSuppressHedge(state)) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log('[ip-rotate]', {
      event: 'hedge-suppressed',
      domain: state.params.targetUrl.host,
      throttledCount: getRecentlyThrottledIndices({
        counters: state.params.counters,
        domain: state.params.targetUrl.host,
        endpointCount: state.endpoints.length,
        throttleTtlMs: state.tuning.throttleTtlMs,
      }).size,
      threshold: state.tuning.hedgeSuppressThreshold,
    });
    return false;
  }
  return true;
};

// Cancel the losing hedge response body stream to release memory immediately
const drainResponseBody = (promise: Promise<FetchAttemptResult>): void => {
  promise
    .then((result: FetchAttemptResult) => {
      result.response?.body?.cancel().catch(() => {});
    })
    .catch(() => {});
};

// Abort the losing fetch in a hedge race and prevent unhandled rejection
const abortHedgeLoser = (winner: HedgeRaceEntry, ctx: HedgeRaceContext): void => {
  if (winner.isPrimary) {
    ctx.hedgeAbort.abort();
    drainResponseBody(ctx.hedgePromise);
    return;
  }
  ctx.primaryAbort.abort();
  drainResponseBody(ctx.primaryPromise);
};

// Race primary vs hedge fetch and return winner
const raceHedgeFetches = async (params: RaceHedgeFetchesParams): Promise<HedgedFetchResult> => {
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', { event: 'hedge-fired', attempt: params.state.attempt });
  const hedgeAbort: AbortController = new AbortController();
  const hedgePromise: Promise<FetchAttemptResult> = tryRegionAwareFetch(
    params.state,
    params.hedgeSelected,
    hedgeAbort.signal,
  );
  const winner: HedgeRaceEntry = await Promise.race([
    params.primaryPromise.then(
      (r: FetchAttemptResult): HedgeRaceEntry => ({ result: r, isPrimary: true }),
    ),
    hedgePromise.then((r: FetchAttemptResult): HedgeRaceEntry => ({ result: r, isPrimary: false })),
  ]);
  abortHedgeLoser(winner, {
    primaryAbort: params.primaryAbort,
    hedgeAbort,
    primaryPromise: params.primaryPromise,
    hedgePromise,
  });
  const winnerSelected: RegionAwareEndpointResult = winner.isPrimary
    ? params.primarySelected
    : params.hedgeSelected;
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log('[ip-rotate]', {
    event: 'hedge-won',
    winner: winner.isPrimary ? 'primary' : 'hedge',
    attempt: params.state.attempt,
  });
  return { result: winner.result, selected: winnerSelected, hedgeStarted: true };
};

// Hedged fetch: race primary vs delayed hedge request
const tryHedgedFetch = async (
  state: RegionAwareRetryState,
  primarySelected: RegionAwareEndpointResult,
  hedgeSelected: RegionAwareEndpointResult,
): Promise<HedgedFetchResult> => {
  const primaryAbort: AbortController = new AbortController();
  const primaryPromise: Promise<FetchAttemptResult> = tryRegionAwareFetch(
    state,
    primarySelected,
    primaryAbort.signal,
  );
  // Phase 1: Race primary completion vs adaptive hedge delay timer.
  // Start with the metrics-driven adaptive delay, then shrink it further as
  // the retry attempt count grows so later retries hedge sooner without
  // firing parallel requests on the very first try.
  const adaptiveDelay: number = getAdaptiveHedgeDelay({
    counters: state.params.counters,
    domain: state.params.targetUrl.host,
    endpointCount: state.endpoints.length,
    defaultDelayMs: state.tuning.hedgeDelayMs,
  });
  const hedgeDelay: number = computeDynamicHedgeDelayMs(state.attempt, adaptiveDelay);
  const earlyResult: FetchAttemptResult | null = await Promise.race([
    primaryPromise.then((r: FetchAttemptResult): FetchAttemptResult => r),
    waitMs(hedgeDelay).then((): null => null),
  ]);
  // Primary completed before hedge delay - no hedge needed
  if (earlyResult) {
    return { result: earlyResult, selected: primarySelected, hedgeStarted: false };
  }
  // Phase 2: Start hedge and race
  return raceHedgeFetches({
    state,
    primarySelected,
    hedgeSelected,
    primaryAbort,
    primaryPromise,
  });
};

// Process fetch attempt result through retry handlers
const processRetryResult = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
  result: FetchAttemptResult,
): Promise<FetchRetryResult> => {
  if (result.timedOut) {
    return handleTimeoutRetry(state, selected, result);
  }
  // Treat Akamai CDN block (403 or 200 with Access Denied body) as a retriable
  // endpoint failure so IP rotation picks a different regional egress IP.
  if (result.response && (await isAkamaiBlockedResponse(result.response))) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log('[ip-rotate]', {
      event: 'akamai-block-detected',
      attempt: state.attempt,
      endpoint: result.usedEndpoint,
      status: result.response.status,
    });
    return handleServerErrorRetry(state, selected, result);
  }
  if (result.response && !isRetriableStatus(result.response.status)) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log('[ip-rotate]', {
      event: 'success',
      attempt: state.attempt,
      endpoint: result.usedEndpoint,
      status: result.response.status,
    });
    updateHealthScore({
      counters: state.params.counters,
      domain: state.params.targetUrl.host,
      index: selected.index,
      isSuccess: true,
    });
    emitEndpointOutcome(state.params, {
      index: selected.index,
      endpoint: result.usedEndpoint,
      status: result.response.status,
      urlHash: state.urlHash,
      isSuccess: true,
      isThrottle: false,
      isServerError: false,
    });
    return createSuccessResult(result.response, result.usedEndpoint);
  }
  if (result.response && isServerErrorStatus(result.response.status)) {
    return handleServerErrorRetry(state, selected, result);
  }
  return handleThrottledRetry(state, selected, result);
};

// Mark hedge endpoint as tried and compute state adjustment
const applyHedgeResult = (
  state: RegionAwareRetryState,
  hedged: HedgedFetchResult,
  hedgeEndpoint: RegionAwareEndpointResult,
): RegionAwareRetryState => {
  if (!hedged.hedgeStarted) return state;
  state.triedEndpointIndices.add(hedgeEndpoint.index);
  if (hedgeEndpoint.region) {
    state.triedRegions.add(hedgeEndpoint.region);
  }
  return { ...state, attempt: state.attempt + 1, hedgeAttemptsUsed: state.hedgeAttemptsUsed + 1 };
};

// Try hedged fetch if eligible, otherwise return null
const tryHedgedAttempt = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
): Promise<FetchRetryResult | null> => {
  if (!isHedgeEligible(state)) return null;
  const hedgeEndpoint: RegionAwareEndpointResult | null = selectEndpointWithWeights(state);
  if (!hedgeEndpoint) return null;
  const hedged: HedgedFetchResult = await tryHedgedFetch(state, selected, hedgeEndpoint);
  const hedgeState: RegionAwareRetryState = applyHedgeResult(state, hedged, hedgeEndpoint);
  return processRetryResult(hedgeState, hedged.selected, hedged.result);
};

const regionAwareRetryAttemptWithSelected = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
): Promise<FetchRetryResult> => {
  state.triedEndpointIndices.add(selected.index);
  if (selected.region) {
    state.triedRegions.add(selected.region);
  }
  // Try hedged fetch if eligible
  const hedgedResult: FetchRetryResult | null = await tryHedgedAttempt(state, selected);
  if (hedgedResult) return hedgedResult;
  // Normal (non-hedged) fetch
  const result: FetchAttemptResult = await tryRegionAwareFetch(state, selected);
  return processRetryResult(state, selected, result);
};

const fetchWithRetry = (params: FetchWithRetryParams): Promise<FetchRetryResult> => {
  const endpointCount: number = getEndpointCount(params.config, params.targetUrl.host);

  if (endpointCount === 0) {
    return Promise.resolve(
      createFailureResult({
        lastResponse: null,
        lastUsedEndpoint: null,
        error: ERROR_NO_ENDPOINTS_AVAILABLE,
        errorCode: 'NO_ENDPOINTS',
        totalAttempts: 0,
      }),
    );
  }

  const endpoints: readonly EndpointWithApiKey[] =
    getEndpointList(params.config, params.targetUrl.host) ?? [];
  const maxRetries: number = calculateMaxRetries(endpointCount);
  const initialTimeout: number =
    params.timeoutMs ?? getDefaultTimeoutFromEnv(params.envDefaultTimeoutMs);
  const timeoutConfig: TimeoutConfig = defaultTimeoutConfig;
  const tuning: ResolvedTuning = resolveTuning(params);
  const urlHash: string = hashUrl(params.targetUrl.toString());

  // Pre-populate triedEndpointIndices with endpoints that recently returned
  // 5xx/6xx FOR THIS URL. Endpoints that failed only for other URLs remain
  // available here, expanding the usable pool per-URL.
  const recentlyFailed: Set<number> = getRecentlyFailedIndices({
    counters: params.counters,
    domain: params.targetUrl.host,
    urlHash,
    endpointCount: endpoints.length,
    healthTtlMs: tuning.healthTtlMs,
  });

  return regionAwareRetryAttempt({
    params,
    endpoints,
    attempt: 0,
    maxRetries,
    lastResponse: null,
    lastUsedEndpoint: null,
    currentTimeoutMs: clampTimeout(initialTimeout, timeoutConfig),
    timeoutConfig,
    triedRegions: new Set<string>(),
    triedEndpointIndices: recentlyFailed,
    serverErrorEndpoints: new Set<number>(),
    wallClockSignal: params.wallClockSignal,
    consecutiveThrottles: 0,
    hedgeAttemptsUsed: 0,
    tuning,
    urlHash,
  });
};

export {
  ABSOLUTE_MAX_RETRIES,
  ACCEPT_ENCODING_IDENTITY,
  buildHealthKey,
  buildThrottleKey,
  calculateMaxRetries,
  calculateThrottleDelay,
  clampTimeout,
  computeDynamicHedgeCap,
  computeDynamicHedgeDelayMs,
  DEFAULT_HEDGE_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  drainResponseBody,
  hashUrl,
  defaultTimeoutConfig,
  ENV_DEFAULT_TIMEOUT,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  ERROR_REQUEST_TIMEOUT,
  ERROR_WALL_CLOCK_TIMEOUT,
  EXTRA_RETRIES_PER_BLACKLIST,
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  getRecentlyFailedIndices,
  getRecentlyThrottledIndices,
  HEALTH_TTL_MS,
  HEDGE_ATTEMPT_COST,
  HEDGE_SUPPRESS_THRESHOLD,
  isRetriableError,
  isRetriableStatus,
  isServerErrorStatus,
  isTimeoutError,
  MAX_HEDGE_ATTEMPTS,
  MAX_RETRIES_MULTIPLIER,
  MAX_TIMEOUT_MS,
  MIN_RETRIES,
  MIN_TIMEOUT_MS,
  parseEnvTimeout,
  parsePositiveIntEnv,
  recordEndpointFailure,
  recordEndpointThrottle,
  resolveTuning,
  STATUS_SERVER_ERROR_START,
  STATUS_TOO_MANY_REQUESTS,
  STATUS_WORKER_RESOURCE_EXHAUSTED,
  stripCompressionEncoding,
  THROTTLE_BACKOFF_MULTIPLIER,
  THROTTLE_BASE_DELAY_MS,
  THROTTLE_JITTER_RATIO,
  THROTTLE_MAX_DELAY_MS,
  THROTTLE_TTL_MS,
  TIMEOUT_BOOST_PER_BLACKLIST_MS,
  waitMs,
};
