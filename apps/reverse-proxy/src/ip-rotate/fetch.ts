// IP Rotation fetch with authentication
// Execute with bun: wrangler dev
// SECURITY: Auth headers are for API Gateway only, NOT passed to target server
// API Gateway consumes x-api-key and IAM signature headers before forwarding

import {
  buildRewrittenUrl,
  getEndpointCount,
  getEndpointList,
  selectRegionAwareEndpoint,
} from './client.ts';
import { signRequest } from './signer.ts';
import type {
  EndpointWithApiKey,
  FetchRetryResult,
  FetchWithAuthParams,
  FetchWithRetryParams,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
  RegionAwareEndpointResult,
  TimeoutConfig,
} from './types.ts';

// Constants at top
const HEADER_API_KEY = 'x-api-key';
const AUTH_TYPE_API_KEY = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const ERROR_INVALID_AUTH_TYPE = 'Invalid auth type';
const ERROR_UNSUPPORTED_AUTH_TYPE = 'Unsupported auth type';
const ERROR_REQUEST_TIMEOUT = 'Request timed out';

// Timeout constants
const ENV_DEFAULT_TIMEOUT = 'DEFAULT_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 2000;
const MIN_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 8000;
const TIMEOUT_ADJUSTMENT_MS = 500;
// biome-ignore lint/nursery/noSecrets: TimeoutError is a standard error name, not a secret
const TIMEOUT_ERROR_NAME = 'TimeoutError';
const ABORT_ERROR_NAME = 'AbortError';
const TYPE_ERROR_NAME = 'TypeError';
const TIMEOUT_MESSAGE_PATTERN: RegExp = /timeout/i;

// Timeout configuration
const defaultTimeoutConfig: TimeoutConfig = {
  defaultMs: DEFAULT_TIMEOUT_MS,
  minMs: MIN_TIMEOUT_MS,
  maxMs: MAX_TIMEOUT_MS,
  adjustmentMs: TIMEOUT_ADJUSTMENT_MS,
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

const adjustTimeoutOnSuccess = (currentTimeout: number, config: TimeoutConfig): number =>
  clampTimeout(currentTimeout - config.adjustmentMs, config);

const adjustTimeoutOnFailure = (currentTimeout: number, config: TimeoutConfig): number =>
  clampTimeout(currentTimeout + config.adjustmentMs, config);

const createAbortSignal = (timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs);

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

const isApiKeyAuth = (auth: IpRotateAuth): auth is IpRotateAuthApiKey =>
  auth.type === AUTH_TYPE_API_KEY;

const isIamAuth = (auth: IpRotateAuth): auth is IpRotateAuthIam => auth.type === AUTH_TYPE_IAM;

const fetchWithApiKey = (params: FetchWithAuthParams): Promise<Response> => {
  if (!isApiKeyAuth(params.auth)) {
    return Promise.reject(new Error(ERROR_INVALID_AUTH_TYPE));
  }
  // x-api-key is consumed by API Gateway, not forwarded to target
  const gatewayHeaders: Record<string, string> = createApiKeyAuthHeaders(
    params.headers,
    params.auth.apiKey,
  );
  return globalThis.fetch(params.url.toString(), {
    method: params.method,
    headers: gatewayHeaders,
    body: params.body,
    signal: params.signal,
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
    headers: params.headers,
    body: params.body,
    auth: params.auth,
  });
  return globalThis.fetch(signed.url, {
    method: params.method,
    headers: signed.headers,
    body: params.body,
    signal: params.signal,
  });
};

// Auth handler map using object instead of Map for compliance
const authHandlers: Record<string, AuthHandler> = {
  [AUTH_TYPE_API_KEY]: fetchWithApiKey,
  [AUTH_TYPE_IAM]: fetchWithIam,
};

const fetchWithAuth = (params: FetchWithAuthParams): Promise<Response> => {
  const handler: AuthHandler | undefined = authHandlers[params.auth.type];
  if (!handler) {
    return Promise.reject(new Error(`${ERROR_UNSUPPORTED_AUTH_TYPE}: ${params.auth.type}`));
  }
  return handler(params);
};

// Constants for retry logic
const STATUS_ERROR_THRESHOLD = 400;
const MIN_RETRIES = 5;
const ERROR_ALL_ENDPOINTS_FAILED = 'All endpoints failed';
const ERROR_NO_ENDPOINTS_AVAILABLE = 'No endpoints available for domain';
const ERROR_WALL_CLOCK_TIMEOUT = 'Wall clock timeout exceeded';

// Helper functions for retry logic
const isErrorStatus = (status: number): boolean => status >= STATUS_ERROR_THRESHOLD;

const calculateMaxRetries = (endpointCount: number): number => Math.max(endpointCount, MIN_RETRIES);

const createSuccessResult = (response: Response, usedEndpoint: string): FetchRetryResult => ({
  success: true,
  response,
  usedEndpoint,
});

const createFailureResult = (
  lastResponse: Response | null,
  lastUsedEndpoint: string | null,
  error: string,
): FetchRetryResult => ({
  success: false,
  lastResponse,
  lastUsedEndpoint,
  error,
});

const createAuthFromEndpoint = (baseAuth: IpRotateAuth, endpointApiKey: string): IpRotateAuth => {
  // If base auth is api-key type, use the endpoint-specific API key
  if (isApiKeyAuth(baseAuth)) {
    return { type: AUTH_TYPE_API_KEY, apiKey: endpointApiKey };
  }
  // For IAM auth, continue using the base auth (credentials are global)
  return baseAuth;
};

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
  readonly wallClockSignal?: AbortSignal;
}

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
): Promise<{ response: Response | null; timedOut: boolean; usedEndpoint: string }> => {
  const rewrittenUrl: URL = buildRewrittenUrl(selected.endpoint.endpoint, state.params.targetUrl);
  const usedEndpoint: string = rewrittenUrl.origin;
  const auth: IpRotateAuth = createAuthFromEndpoint(
    state.params.config.auth,
    selected.endpoint.apiKey,
  );

  try {
    const perAttemptSignal: AbortSignal = createAbortSignal(state.currentTimeoutMs);
    const signal: AbortSignal = state.wallClockSignal
      ? AbortSignal.any([perAttemptSignal, state.wallClockSignal])
      : perAttemptSignal;
    const response: Response = await fetchWithAuth({
      url: rewrittenUrl,
      auth,
      headers: state.params.headers,
      method: state.params.method,
      body: state.params.body,
      signal,
    });
    return { response, timedOut: false, usedEndpoint };
  } catch (error: unknown) {
    if (isRetriableError(error)) {
      return { response: null, timedOut: true, usedEndpoint };
    }
    throw error;
  }
};

const regionAwareRetryAttempt = (state: RegionAwareRetryState): Promise<FetchRetryResult> => {
  if (state.wallClockSignal?.aborted) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log('[ip-rotate] wall clock timeout exceeded, stopping retries');
    return Promise.resolve(
      createFailureResult(state.lastResponse, state.lastUsedEndpoint, ERROR_WALL_CLOCK_TIMEOUT),
    );
  }

  if (state.attempt >= state.maxRetries) {
    return Promise.resolve(
      createFailureResult(state.lastResponse, state.lastUsedEndpoint, ERROR_ALL_ENDPOINTS_FAILED),
    );
  }

  const selected: RegionAwareEndpointResult | null = selectRegionAwareEndpoint({
    endpoints: state.endpoints,
    triedRegions: state.triedRegions,
    triedEndpointIndices: state.triedEndpointIndices,
  });

  if (!selected) {
    // All endpoints tried, fall back to round-robin from the beginning
    state.triedEndpointIndices.clear();
    state.triedRegions.clear();
    const retrySelected: RegionAwareEndpointResult | null = selectRegionAwareEndpoint({
      endpoints: state.endpoints,
      triedRegions: state.triedRegions,
      triedEndpointIndices: state.triedEndpointIndices,
    });
    if (!retrySelected) {
      return Promise.resolve(
        createFailureResult(
          state.lastResponse,
          state.lastUsedEndpoint,
          ERROR_NO_ENDPOINTS_AVAILABLE,
        ),
      );
    }
    return regionAwareRetryAttemptWithSelected(state, retrySelected);
  }

  return regionAwareRetryAttemptWithSelected(state, selected);
};

const regionAwareRetryAttemptWithSelected = async (
  state: RegionAwareRetryState,
  selected: RegionAwareEndpointResult,
): Promise<FetchRetryResult> => {
  state.triedEndpointIndices.add(selected.index);
  if (selected.region) {
    state.triedRegions.add(selected.region);
  }

  const result = await tryRegionAwareFetch(state, selected);

  if (result.timedOut) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(
      `[ip-rotate] retry attempt=${state.attempt} endpoint=${result.usedEndpoint} reason=timeout`,
    );
    const newTimeout: number = adjustTimeoutOnFailure(state.currentTimeoutMs, state.timeoutConfig);
    return regionAwareRetryAttempt({
      ...state,
      attempt: state.attempt + 1,
      lastUsedEndpoint: result.usedEndpoint,
      currentTimeoutMs: newTimeout,
    });
  }

  if (result.response && !isErrorStatus(result.response.status)) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(`[ip-rotate] success attempt=${state.attempt} endpoint=${result.usedEndpoint}`);
    return createSuccessResult(result.response, result.usedEndpoint);
  }

  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log(
    `[ip-rotate] retry attempt=${state.attempt} endpoint=${result.usedEndpoint} reason=error-status`,
  );
  const newTimeout: number = adjustTimeoutOnFailure(state.currentTimeoutMs, state.timeoutConfig);
  return regionAwareRetryAttempt({
    ...state,
    attempt: state.attempt + 1,
    lastResponse: result.response,
    lastUsedEndpoint: result.usedEndpoint,
    currentTimeoutMs: newTimeout,
  });
};

const fetchWithRetry = (params: FetchWithRetryParams): Promise<FetchRetryResult> => {
  const endpointCount: number = getEndpointCount(params.config, params.targetUrl.host);

  if (endpointCount === 0) {
    return Promise.resolve(createFailureResult(null, null, ERROR_NO_ENDPOINTS_AVAILABLE));
  }

  const endpoints: readonly EndpointWithApiKey[] =
    getEndpointList(params.config, params.targetUrl.host) ?? [];
  const maxRetries: number = calculateMaxRetries(endpointCount);
  const initialTimeout: number =
    params.timeoutMs ?? getDefaultTimeoutFromEnv(params.envDefaultTimeoutMs);
  const timeoutConfig: TimeoutConfig = defaultTimeoutConfig;

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
    triedEndpointIndices: new Set<number>(),
    wallClockSignal: params.wallClockSignal,
  });
};

export {
  adjustTimeoutOnFailure,
  adjustTimeoutOnSuccess,
  calculateMaxRetries,
  clampTimeout,
  DEFAULT_TIMEOUT_MS,
  defaultTimeoutConfig,
  ENV_DEFAULT_TIMEOUT,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  ERROR_REQUEST_TIMEOUT,
  ERROR_WALL_CLOCK_TIMEOUT,
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  isErrorStatus,
  isRetriableError,
  isTimeoutError,
  MAX_TIMEOUT_MS,
  MIN_RETRIES,
  MIN_TIMEOUT_MS,
  parseEnvTimeout,
  STATUS_ERROR_THRESHOLD,
  TIMEOUT_ADJUSTMENT_MS,
};
