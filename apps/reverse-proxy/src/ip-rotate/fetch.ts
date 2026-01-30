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
} from './types.ts';

// Constants at top
const HEADER_API_KEY = 'x-api-key';
const AUTH_TYPE_API_KEY: 'api-key' = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const ERROR_INVALID_AUTH_TYPE = 'Invalid auth type';
const ERROR_UNSUPPORTED_AUTH_TYPE = 'Unsupported auth type';

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

const tryFetchEndpoint = async (
  params: FetchWithRetryParams,
): Promise<{ response: Response | null; rewriteSuccess: boolean }> => {
  const rewriteResult: RewriteUrlResult = rewriteUrlForIpRotate(
    params.config,
    params.targetUrl,
    params.counters,
  );

  if (!rewriteResult.success) {
    return { response: null, rewriteSuccess: false };
  }

  // Use the endpoint-specific API key from the rewrite result
  const auth: IpRotateAuth = createAuthFromEndpoint(params.config.auth, rewriteResult.apiKey);

  const response: Response = await fetchWithAuth({
    url: rewriteResult.url,
    auth,
    headers: params.headers,
    method: params.method,
    body: params.body,
  });

  return { response, rewriteSuccess: true };
};

interface RetryAttemptParams {
  readonly params: FetchWithRetryParams;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly lastResponse: Response | null;
}

const retryAttempt = async (retryParams: RetryAttemptParams): Promise<FetchRetryResult> => {
  if (retryParams.attempt >= retryParams.maxRetries) {
    return createFailureResult(retryParams.lastResponse, ERROR_ALL_ENDPOINTS_FAILED);
  }

  const result = await tryFetchEndpoint(retryParams.params);

  if (!result.rewriteSuccess) {
    return createFailureResult(retryParams.lastResponse, ERROR_NO_ENDPOINTS_AVAILABLE);
  }

  if (result.response && !isErrorStatus(result.response.status)) {
    return createSuccessResult(result.response);
  }

  return retryAttempt({
    params: retryParams.params,
    attempt: retryParams.attempt + 1,
    maxRetries: retryParams.maxRetries,
    lastResponse: result.response,
  });
};

const fetchWithRetry = (params: FetchWithRetryParams): Promise<FetchRetryResult> => {
  const endpointCount: number = getEndpointCount(params.config, params.targetUrl.host);

  if (endpointCount === 0) {
    return Promise.resolve(createFailureResult(null, ERROR_NO_ENDPOINTS_AVAILABLE));
  }

  const maxRetries: number = calculateMaxRetries(endpointCount);

  return retryAttempt({
    params,
    attempt: 0,
    maxRetries,
    lastResponse: null,
  });
};

export {
  calculateMaxRetries,
  ERROR_ALL_ENDPOINTS_FAILED,
  ERROR_NO_ENDPOINTS_AVAILABLE,
  fetchWithAuth,
  fetchWithRetry,
  isErrorStatus,
  STATUS_ERROR_THRESHOLD,
};
