// IP Rotation fetch with authentication
// Execute with bun: wrangler dev
// SECURITY: Auth headers are for API Gateway only, NOT passed to target server
// API Gateway consumes x-api-key and IAM signature headers before forwarding

import { signRequest } from './signer.ts';
import type {
  FetchWithAuthParams,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
} from './types.ts';

// Constants at top
const HEADER_API_KEY = 'x-api-key';
const AUTH_TYPE_API_KEY = 'api-key';
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

export { fetchWithAuth };
