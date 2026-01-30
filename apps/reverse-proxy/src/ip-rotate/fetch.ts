// IP Rotation fetch with authentication
// Execute with bun: wrangler dev
// SECURITY: Auth headers are for API Gateway only, NOT passed to target server
// API Gateway consumes x-api-key and IAM signature headers before forwarding

import { getEndpointCount, rewriteUrlForIpRotate } from './client.ts';
import { signRequest } from './signer.ts';
import type {
  FetchRetryResult,
  FetchWithAuthParams,
  FetchWithRetryParams,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
  RewriteUrlResult,
  TimeoutConfig,
} from './types.ts';

// Constants at top
const HEADER_API_KEY = 'x-api-key';
const AUTH_TYPE_API_KEY: 'api-key' = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const ERROR_INVALID_AUTH_TYPE = 'Invalid auth type';
const ERROR_UNSUPPORTED_AUTH_TYPE = 'Unsupported auth type';
const ERROR_REQUEST_TIMEOUT = 'Request timed out';

// Timeout constants
const ENV_DEFAULT_TIMEOUT = 'DEFAULT_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 3000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 10000;
const TIMEOUT_ADJUSTMENT_MS = 500;
// biome-ignore lint/nursery/noSecrets: TimeoutError is a standard error name, not a secret
const TIMEOUT_ERROR_NAME = 'TimeoutError';

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
const RETRY_MULTIPLIER = 2;
const ERROR_ALL_ENDPOINTS_FAILED = 'All endpoints failed';
const ERROR_NO_ENDPOINTS_AVAILABLE = 'No endpoints available for domain';

// Helper functions for retry logic
const isErrorStatus = (status: number): boolean => status >= STATUS_ERROR_THRESHOLD;

const calculateMaxRetries = (endpointCount: number): number => endpointCount * RETRY_MULTIPLIER;

const createSuccessResult = (response: Response): FetchRetryResult => ({
  success: true,
  response,
});

const createFailureResult = (lastResponse: Response | null, error: string): FetchRetryResult => ({
  success: false,
  lastResponse,
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

interface TryFetchEndpointParams {
  readonly params: FetchWithRetryParams;
  readonly timeoutMs: number;
}

interface TryFetchResult {
  readonly response: Response | null;
  readonly rewriteSuccess: boolean;
  readonly timedOut: boolean;
}

interface RetryAttemptParams {
  readonly params: FetchWithRetryParams;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly lastResponse: Response | null;
  readonly currentTimeoutMs: number;
  readonly timeoutConfig: TimeoutConfig;
}

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.name === TIMEOUT_ERROR_NAME;

const tryFetchEndpoint = async (fetchParams: TryFetchEndpointParams): Promise<TryFetchResult> => {
  const rewriteResult: RewriteUrlResult = rewriteUrlForIpRotate(
    fetchParams.params.config,
    fetchParams.params.targetUrl,
    fetchParams.params.counters,
  );

  if (!rewriteResult.success) {
    return { response: null, rewriteSuccess: false, timedOut: false };
  }

  // Use the endpoint-specific API key from the rewrite result
  const auth: IpRotateAuth = createAuthFromEndpoint(
    fetchParams.params.config.auth,
    rewriteResult.apiKey,
  );

  try {
    const signal: AbortSignal = createAbortSignal(fetchParams.timeoutMs);
    const response: Response = await fetchWithAuth({
      url: rewriteResult.url,
      auth,
      headers: fetchParams.params.headers,
      method: fetchParams.params.method,
      body: fetchParams.params.body,
      signal,
    });
    return { response, rewriteSuccess: true, timedOut: false };
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      return { response: null, rewriteSuccess: true, timedOut: true };
    }
    throw error;
  }
};

const retryAttempt = async (retryParams: RetryAttemptParams): Promise<FetchRetryResult> => {
  if (retryParams.attempt >= retryParams.maxRetries) {
    return createFailureResult(retryParams.lastResponse, ERROR_ALL_ENDPOINTS_FAILED);
  }

  const result: TryFetchResult = await tryFetchEndpoint({
    params: retryParams.params,
    timeoutMs: retryParams.currentTimeoutMs,
  });

  if (!result.rewriteSuccess) {
    return createFailureResult(retryParams.lastResponse, ERROR_NO_ENDPOINTS_AVAILABLE);
  }

  // Handle timeout - increase timeout and retry
  if (result.timedOut) {
    const newTimeout: number = adjustTimeoutOnFailure(
      retryParams.currentTimeoutMs,
      retryParams.timeoutConfig,
    );
    return retryAttempt({
      params: retryParams.params,
      attempt: retryParams.attempt + 1,
      maxRetries: retryParams.maxRetries,
      lastResponse: retryParams.lastResponse,
      currentTimeoutMs: newTimeout,
      timeoutConfig: retryParams.timeoutConfig,
    });
  }

  // Handle success - decrease timeout for next request
  if (result.response && !isErrorStatus(result.response.status)) {
    return createSuccessResult(result.response);
  }

  // Handle error status - increase timeout and retry
  const newTimeout: number = adjustTimeoutOnFailure(
    retryParams.currentTimeoutMs,
    retryParams.timeoutConfig,
  );
  return retryAttempt({
    params: retryParams.params,
    attempt: retryParams.attempt + 1,
    maxRetries: retryParams.maxRetries,
    lastResponse: result.response,
    currentTimeoutMs: newTimeout,
    timeoutConfig: retryParams.timeoutConfig,
  });
};

const fetchWithRetry = (params: FetchWithRetryParams): Promise<FetchRetryResult> => {
  const endpointCount: number = getEndpointCount(params.config, params.targetUrl.host);

  if (endpointCount === 0) {
    return Promise.resolve(createFailureResult(null, ERROR_NO_ENDPOINTS_AVAILABLE));
  }

  const maxRetries: number = calculateMaxRetries(endpointCount);
  const initialTimeout: number =
    params.timeoutMs ?? getDefaultTimeoutFromEnv(params.envDefaultTimeoutMs);
  const timeoutConfig: TimeoutConfig = defaultTimeoutConfig;

  return retryAttempt({
    params,
    attempt: 0,
    maxRetries,
    lastResponse: null,
    currentTimeoutMs: clampTimeout(initialTimeout, timeoutConfig),
    timeoutConfig,
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
  fetchWithAuth,
  fetchWithRetry,
  getDefaultTimeoutFromEnv,
  isErrorStatus,
  isTimeoutError,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  parseEnvTimeout,
  STATUS_ERROR_THRESHOLD,
  TIMEOUT_ADJUSTMENT_MS,
};
