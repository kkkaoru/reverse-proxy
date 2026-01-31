// IP Rotation client - endpoint management and round-robin selection
// Execute with bun: wrangler dev

import type {
  EndpointWithApiKey,
  GetEndpointParams,
  GetNextEndpointResult,
  IpRotateAuth,
  IpRotateConfig,
  IpRotateEndpoints,
  ParseConfigParams,
  ParsedConfig,
  RewriteUrlResult,
} from './types.ts';

// Constants at top
const AUTH_TYPE_API_KEY = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const ERROR_MISSING_ENDPOINTS = 'IP_ROTATE_ENDPOINTS is required';
const ERROR_INVALID_ENDPOINTS_JSON = 'IP_ROTATE_ENDPOINTS must be valid JSON';
const ERROR_MISSING_API_KEY = 'IP_ROTATE_API_KEY is required for api-key auth';
const ERROR_MISSING_IAM_CREDENTIALS = 'AWS credentials are required for IAM auth';

// Pure functions with guard pattern
const getEndpointList = (
  config: IpRotateConfig,
  domain: string,
): readonly EndpointWithApiKey[] | undefined => config.endpoints[domain];

const isIpRotateTarget = (config: IpRotateConfig, domain: string): boolean =>
  getEndpointList(config, domain) !== undefined;

const getEndpointCount = (config: IpRotateConfig, domain: string): number => {
  const endpoints: readonly EndpointWithApiKey[] | undefined = getEndpointList(config, domain);
  return endpoints?.length ?? 0;
};

const getRandomInitialIndex = (length: number): number => Math.floor(Math.random() * length);

const getOrInitializeCounter = (
  counters: Map<string, number>,
  domain: string,
  endpointCount: number,
): number => {
  const existing: number | undefined = counters.get(domain);
  if (existing !== undefined) {
    return existing;
  }
  const initialIndex: number = getRandomInitialIndex(endpointCount);
  counters.set(domain, initialIndex);
  return initialIndex;
};

const getNextEndpoint = (params: GetEndpointParams): GetNextEndpointResult | null => {
  const endpoints: readonly EndpointWithApiKey[] | undefined = getEndpointList(
    params.config,
    params.domain,
  );
  if (!endpoints) {
    return null;
  }
  if (endpoints.length === 0) {
    return null;
  }

  const current: number = getOrInitializeCounter(params.counters, params.domain, endpoints.length);
  const endpointEntry: EndpointWithApiKey | undefined = endpoints[current % endpoints.length];
  if (!endpointEntry) {
    return null;
  }
  params.counters.set(params.domain, current + 1);
  return { endpoint: endpointEntry.endpoint, apiKey: endpointEntry.apiKey };
};

// Double-encode specific query parameters to preserve encoding through API Gateway
const DOUBLE_ENCODE_PARAMS: readonly string[] = ['word'];

const doubleEncodeQueryParam = (search: string, paramName: string): string => {
  const pattern: RegExp = new RegExp(`(${paramName}=)([^&]*)`, 'gi');
  return search.replace(pattern, (_match, prefix: string, value: string) => {
    const doubleEncoded: string = encodeURIComponent(value);
    return `${prefix}${doubleEncoded}`;
  });
};

const doubleEncodeSearchParams = (search: string): string => {
  let result: string = search;
  for (const param of DOUBLE_ENCODE_PARAMS) {
    result = doubleEncodeQueryParam(result, param);
  }
  return result;
};

const buildRewrittenUrl = (endpoint: string, targetUrl: URL): URL => {
  const encodedSearch: string = doubleEncodeSearchParams(targetUrl.search);
  return new URL(`${endpoint}${targetUrl.pathname}${encodedSearch}`);
};

const rewriteUrlForIpRotate = (
  config: IpRotateConfig,
  targetUrl: URL,
  counters: Map<string, number>,
): RewriteUrlResult => {
  const endpointResult: GetNextEndpointResult | null = getNextEndpoint({
    config,
    domain: targetUrl.host,
    counters,
  });
  if (!endpointResult) {
    return { success: false };
  }

  const rewrittenUrl: URL = buildRewrittenUrl(endpointResult.endpoint, targetUrl);
  return { success: true, url: rewrittenUrl, apiKey: endpointResult.apiKey };
};

const parseEndpointsJson = (json: string): IpRotateEndpoints | null => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const createApiKeyAuth = (apiKey: string): IpRotateAuth => ({
  type: AUTH_TYPE_API_KEY,
  apiKey,
});

const createIamAuth = (
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): IpRotateAuth => ({
  type: AUTH_TYPE_IAM,
  accessKeyId,
  secretAccessKey,
  region,
});

const parseApiKeyConfig = (
  params: ParseConfigParams,
  endpoints: IpRotateEndpoints,
): ParsedConfig => {
  if (!params.apiKey) {
    return { success: false, error: ERROR_MISSING_API_KEY };
  }
  return {
    success: true,
    config: {
      endpoints,
      auth: createApiKeyAuth(params.apiKey),
    },
  };
};

const parseIamConfig = (params: ParseConfigParams, endpoints: IpRotateEndpoints): ParsedConfig => {
  if (!(params.accessKeyId && params.secretAccessKey && params.region)) {
    return { success: false, error: ERROR_MISSING_IAM_CREDENTIALS };
  }
  return {
    success: true,
    config: {
      endpoints,
      auth: createIamAuth(params.accessKeyId, params.secretAccessKey, params.region),
    },
  };
};

const parseIpRotateConfig = (params: ParseConfigParams): ParsedConfig => {
  if (!params.endpointsJson) {
    return { success: false, error: ERROR_MISSING_ENDPOINTS };
  }

  const endpoints: IpRotateEndpoints | null = parseEndpointsJson(params.endpointsJson);
  if (!endpoints) {
    return { success: false, error: ERROR_INVALID_ENDPOINTS_JSON };
  }

  const authType: string = params.authType ?? AUTH_TYPE_API_KEY;

  return authType === AUTH_TYPE_IAM
    ? parseIamConfig(params, endpoints)
    : parseApiKeyConfig(params, endpoints);
};

export {
  AUTH_TYPE_API_KEY,
  AUTH_TYPE_IAM,
  getEndpointCount,
  getNextEndpoint,
  isIpRotateTarget,
  parseIpRotateConfig,
  rewriteUrlForIpRotate,
};
