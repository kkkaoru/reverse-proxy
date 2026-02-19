// IP Rotation client - endpoint management and round-robin selection
// Execute with bun: wrangler dev

import type {
  EndpointWithApiKey,
  GetEndpointParams,
  GetNextEndpointResult,
  IndexedEndpoint,
  IpRotateAuth,
  IpRotateConfig,
  IpRotateEndpoints,
  ParseConfigParams,
  ParsedConfig,
  RegionAwareEndpointResult,
  RewriteUrlResult,
  SelectRegionAwareEndpointParams,
} from './types.ts';

// Constants at top
const AUTH_TYPE_API_KEY = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const KV_KEY_IP_ROTATE_ENDPOINTS = 'ip-rotate-endpoints';
const REGION_EXTRACT_PATTERN = /\.execute-api\.([^.]+)\.amazonaws\.com/;
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

const extractRegionFromEndpoint = (endpoint: string): string | null => {
  const match: RegExpMatchArray | null = endpoint.match(REGION_EXTRACT_PATTERN);
  return match?.[1] ?? null;
};

const pickRandomElement = <T>(items: readonly T[]): T | undefined =>
  items.length === 0 ? undefined : items[Math.floor(Math.random() * items.length)];

// Build cumulative weight sums for weighted random selection
const buildCumulativeWeights = (weights: readonly number[]): readonly number[] =>
  weights.map((_: number, i: number) =>
    weights.slice(0, i + 1).reduce((sum: number, w: number) => sum + w, 0),
  );

// Extract weights for candidate subset from full endpoint weights array
const extractCandidateWeights = (
  candidates: readonly IndexedEndpoint[],
  weights: readonly number[] | undefined,
): readonly number[] | undefined =>
  weights ? candidates.map(({ index }: IndexedEndpoint) => weights.at(index) ?? 1) : undefined;

// Pick a random element with optional weights (falls back to uniform random)
const pickWeightedRandomElement = <T>(
  items: readonly T[],
  weights?: readonly number[],
): T | undefined => {
  if (items.length === 0) return undefined;
  if (!weights) return pickRandomElement(items);
  const cumulative: readonly number[] = buildCumulativeWeights(weights);
  const total: number = cumulative.at(-1) ?? 0;
  if (total === 0) return pickRandomElement(items);
  const target: number = Math.random() * total;
  const selectedIndex: number = cumulative.findIndex((cw: number) => target < cw);
  return selectedIndex >= 0 ? items.at(selectedIndex) : items.at(items.length - 1);
};

const toIndexedEndpoint = (ep: EndpointWithApiKey, i: number): IndexedEndpoint => ({
  endpoint: ep,
  index: i,
});

const toRegionResult = (found: IndexedEndpoint): RegionAwareEndpointResult => {
  const region: string | null = extractRegionFromEndpoint(found.endpoint.endpoint);
  return { endpoint: found.endpoint, region: region ?? '', index: found.index };
};

const findEndpointInUntriedRegion = (
  params: SelectRegionAwareEndpointParams,
): RegionAwareEndpointResult | null => {
  const candidates: readonly IndexedEndpoint[] = params.endpoints
    .map(toIndexedEndpoint)
    .filter(({ endpoint, index }: IndexedEndpoint): boolean => {
      if (params.triedEndpointIndices.has(index)) return false;
      const region: string | null = extractRegionFromEndpoint(endpoint.endpoint);
      return region !== null && !params.triedRegions.has(region);
    });
  const found: IndexedEndpoint | undefined = pickWeightedRandomElement(
    candidates,
    extractCandidateWeights(candidates, params.endpointWeights),
  );
  return found ? toRegionResult(found) : null;
};

const findAnyUntriedEndpoint = (
  params: SelectRegionAwareEndpointParams,
): RegionAwareEndpointResult | null => {
  const candidates: readonly IndexedEndpoint[] = params.endpoints
    .map(toIndexedEndpoint)
    .filter(({ index }: IndexedEndpoint): boolean => !params.triedEndpointIndices.has(index));
  const found: IndexedEndpoint | undefined = pickWeightedRandomElement(
    candidates,
    extractCandidateWeights(candidates, params.endpointWeights),
  );
  return found ? toRegionResult(found) : null;
};

const selectRegionAwareEndpoint = (
  params: SelectRegionAwareEndpointParams,
): RegionAwareEndpointResult | null =>
  findEndpointInUntriedRegion(params) ?? findAnyUntriedEndpoint(params);

const parseBannedRegions = (envValue: string | undefined): ReadonlySet<string> => {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(',')
      .map((r: string) => r.trim())
      .filter(Boolean),
  );
};

const filterEndpointsForDomain = (
  eps: readonly EndpointWithApiKey[],
  bannedRegions: ReadonlySet<string>,
): readonly EndpointWithApiKey[] =>
  eps.filter((ep: EndpointWithApiKey) => {
    const region: string | null = extractRegionFromEndpoint(ep.endpoint);
    return region === null || !bannedRegions.has(region);
  });

const filterEndpointsByBannedRegions = (
  endpoints: IpRotateEndpoints,
  bannedRegions: ReadonlySet<string>,
): IpRotateEndpoints =>
  Object.fromEntries(
    Object.entries(endpoints).map(([domain, eps]: [string, readonly EndpointWithApiKey[]]) => [
      domain,
      filterEndpointsForDomain(eps, bannedRegions),
    ]),
  );

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

const loadEndpointsJsonFromKv = async (kv: KVNamespace | undefined): Promise<string | null> => {
  if (!kv) return null;
  return await kv.get(KV_KEY_IP_ROTATE_ENDPOINTS, 'text');
};

export {
  AUTH_TYPE_API_KEY,
  AUTH_TYPE_IAM,
  KV_KEY_IP_ROTATE_ENDPOINTS,
  buildCumulativeWeights,
  buildRewrittenUrl,
  extractRegionFromEndpoint,
  filterEndpointsByBannedRegions,
  getEndpointCount,
  getEndpointList,
  getNextEndpoint,
  isIpRotateTarget,
  loadEndpointsJsonFromKv,
  parseBannedRegions,
  parseIpRotateConfig,
  pickRandomElement,
  pickWeightedRandomElement,
  rewriteUrlForIpRotate,
  selectRegionAwareEndpoint,
};
