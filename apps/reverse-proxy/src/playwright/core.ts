// Core logic for Playwright route - browser-independent
// This module contains all caching, validation, and response handling logic
// that can be tested without the @cloudflare/playwright dependency

import {
  isIpRotateTarget,
  parseIpRotateConfig,
  rewriteUrlForIpRotate,
} from '../ip-rotate/client.ts';
import { fetchWithAuth } from '../ip-rotate/fetch.ts';
import type { IpRotateConfig, ParsedConfig, RewriteUrlResult } from '../ip-rotate/types.ts';

// Interfaces
export interface PlaywrightCoreEnv {
  KV?: KVNamespace;
  LOG_REQUESTS?: string;
  CACHE_VERSION: string;
  IP_ROTATE_ENDPOINTS?: string;
  IP_ROTATE_AUTH_TYPE?: string;
  IP_ROTATE_API_KEY?: string;
  IP_ROTATE_AWS_ACCESS_KEY_ID?: string;
  IP_ROTATE_AWS_SECRET_ACCESS_KEY?: string;
  IP_ROTATE_AWS_REGION?: string;
}

export interface FetchPageResult {
  content: string;
  contentType: string;
  status: number;
  error?: never;
}

export interface FetchPageError {
  html?: never;
  error: string;
}

export interface CachedContent {
  content: string;
  contentType: string;
}

interface SetCachedContentParams {
  kv: KVNamespace;
  cacheKey: string;
  data: CachedContent;
}

export interface LogEventDetail {
  path?: string;
  target?: string;
  cacheKey?: string;
  error?: string;
  status?: number;
}

interface HandleCacheHitParams {
  env: PlaywrightCoreEnv;
  targetUrl: string;
  cacheKey: string;
  cached: CachedContent;
}

export interface HandleFetchSuccessParams {
  env: PlaywrightCoreEnv;
  targetUrl: string;
  cacheKey: string;
  content: string;
  contentType: string;
  status: number;
  disableKv: boolean;
}

export interface TryGetCachedParams {
  env: PlaywrightCoreEnv;
  targetUrl: string;
  cacheKey: string;
  disableKv: boolean;
  disableCache: boolean;
}

export interface CreateContentResponseParams {
  content: string;
  contentType: string;
  cacheStatus: string;
}

export interface ParsedRequest {
  targetUrl: string | null;
  disableKv: boolean;
  disableCache: boolean;
}

export interface HandleRequestParams {
  env: PlaywrightCoreEnv;
  targetUrl: string;
  cacheKey: string;
  disableKv: boolean;
  disableCache: boolean;
  fetchPage: () => Promise<FetchPageResponse>;
  ipRotateOptions?: IpRotateOptions;
}

export interface IpRotateFetchParams {
  readonly url: URL;
  readonly config: IpRotateConfig;
  readonly counters: Map<string, number>;
}

export interface IpRotateOptions {
  readonly config: IpRotateConfig | undefined;
  readonly counters: Map<string, number>;
}

// Types
export type FetchPageResponse = FetchPageResult | FetchPageError;

// Type guards
export const isFetchSuccess = (result: FetchPageResponse): result is FetchPageResult =>
  result.error === undefined;

export const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

// Constants
export const QUERY_PARAM_URL: string = 'url';
export const QUERY_PARAM_DISABLE_KV: string = 'disable_kv';
export const QUERY_PARAM_DISABLE_CACHE: string = 'disable_cache';
export const TRUE_VALUE: string = 'true';
export const STATUS_OK: number = 200;
export const STATUS_NOT_FOUND: number = 404;
export const STATUS_BAD_REQUEST: number = 400;
export const STATUS_CLIENT_ERROR_START: number = 400;
export const STATUS_BAD_GATEWAY: number = 502;
export const HEADER_CONTENT_TYPE: string = 'content-type';
export const HEADER_X_CACHE: string = 'x-cache';
export const CONTENT_TYPE_HTML: string = 'text/html; charset=utf-8';
export const CONTENT_TYPE_JSON: string = 'application/json; charset=utf-8';
export const CONTENT_TYPE_HTML_PREFIX: string = 'text/html';
export const CACHE_TTL_SECONDS: number = 432000; // 5 days (86400 * 5)
export const CACHE_HIT: string = 'HIT';
export const CACHE_MISS: string = 'MISS';
export const LOG_PREFIX: string = '[reverse-proxy-playwright]';
export const ERROR_MISSING_URL: string = 'Query parameter "url" is required.';
export const ERROR_INVALID_URL: string = 'Query parameter "url" must be a valid absolute URL.';
export const ERROR_UNKNOWN_FETCH: string = 'Unknown error during page fetch';
export const LOG_REQUESTS_ENABLED: string = 'TRUE';
export const PLAYWRIGHT_PATH: string = '/playwright';
export const METHOD_GET: string = 'GET';
export const LOG_EVENT_IP_ROTATE: string = 'ip-rotate-fetch';

// IP Rotate functions
export const parseIpRotateConfigFromEnv = (env: PlaywrightCoreEnv): IpRotateConfig | undefined => {
  const parsed: ParsedConfig = parseIpRotateConfig({
    endpointsJson: env.IP_ROTATE_ENDPOINTS,
    authType: env.IP_ROTATE_AUTH_TYPE,
    apiKey: env.IP_ROTATE_API_KEY,
    accessKeyId: env.IP_ROTATE_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.IP_ROTATE_AWS_SECRET_ACCESS_KEY,
    region: env.IP_ROTATE_AWS_REGION,
  });

  return parsed.success ? parsed.config : undefined;
};

export const shouldUseIpRotateForPlaywright = (
  config: IpRotateConfig | undefined,
  url: URL,
): boolean => {
  if (!config) {
    return false;
  }
  return isIpRotateTarget(config, url.host);
};

export const fetchViaIpRotateForPlaywright = (
  params: IpRotateFetchParams,
): Promise<Response> | null => {
  const rewriteResult: RewriteUrlResult = rewriteUrlForIpRotate(
    params.config,
    params.url,
    params.counters,
  );

  if (!rewriteResult.success) {
    return null;
  }

  return fetchWithAuth({
    url: rewriteResult.url,
    auth: params.config.auth,
    headers: {},
    method: METHOD_GET,
  });
};

export const tryFetchWithIpRotate = async (
  env: PlaywrightCoreEnv,
  targetUrl: string,
  options: IpRotateOptions,
): Promise<FetchPageResponse | null> => {
  const url: URL = new URL(targetUrl);

  if (!shouldUseIpRotateForPlaywright(options.config, url)) {
    return null;
  }

  if (!options.config) {
    return null;
  }

  const response: Response | null = await fetchViaIpRotateForPlaywright({
    url,
    config: options.config,
    counters: options.counters,
  });

  if (!response) {
    return null;
  }

  logEvent(env, LOG_EVENT_IP_ROTATE, { target: targetUrl });

  const content: string = await response.text();
  const contentType: string = response.headers.get(HEADER_CONTENT_TYPE) ?? CONTENT_TYPE_HTML;

  return {
    content,
    contentType,
    status: response.status,
  };
};

// Functions
export const isLoggingEnabled = (env: PlaywrightCoreEnv): boolean =>
  env.LOG_REQUESTS?.toUpperCase() === LOG_REQUESTS_ENABLED;

export const logEvent = (env: PlaywrightCoreEnv, event: string, detail: LogEventDetail): void => {
  if (!isLoggingEnabled(env)) {
    return;
  }
  // biome-ignore lint/suspicious/noConsole: explicit logging requested for observability.
  console.log(LOG_PREFIX, event, detail);
};

export const createContentResponse = (params: CreateContentResponseParams): Response =>
  new Response(params.content, {
    status: STATUS_OK,
    headers: {
      [HEADER_CONTENT_TYPE]: params.contentType,
      [HEADER_X_CACHE]: params.cacheStatus,
    },
  });

export const createErrorResponse = (message: string, status: number): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

export const createJsonResponse = (data: object, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

export const createCacheKey = (url: string, cacheVersion: string): string =>
  `playwright-${cacheVersion}::${url}`;

export const parseCachedContent = (cached: string): CachedContent => JSON.parse(cached);

export const getCachedContent = async (
  kv: KVNamespace,
  cacheKey: string,
): Promise<CachedContent | null> => {
  const cached: string | null = await kv.get(cacheKey, 'text');

  if (!cached) {
    return null;
  }

  return parseCachedContent(cached);
};

export const setCachedContent = (params: SetCachedContentParams): Promise<void> =>
  params.kv.put(params.cacheKey, JSON.stringify(params.data), { expirationTtl: CACHE_TTL_SECONDS });

export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ERROR_UNKNOWN_FETCH;

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isHtmlContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith(CONTENT_TYPE_HTML_PREFIX);

const handleCacheHit = (params: HandleCacheHitParams): Response => {
  logEvent(params.env, 'cache-hit', { target: params.targetUrl, cacheKey: params.cacheKey });
  return createContentResponse({
    content: params.cached.content,
    contentType: params.cached.contentType,
    cacheStatus: CACHE_HIT,
  });
};

export const handleFetchError = (
  env: PlaywrightCoreEnv,
  targetUrl: string,
  errorMessage: string,
): Response => {
  logEvent(env, 'fetch-error', { target: targetUrl, error: errorMessage });
  return createErrorResponse(`Browser fetch failed: ${errorMessage}`, STATUS_BAD_GATEWAY);
};

export const shouldCache = (env: PlaywrightCoreEnv, status: number, disableKv: boolean): boolean =>
  !disableKv && env.KV !== undefined && isCacheableStatus(status);

export const shouldLogCacheSkip = (env: PlaywrightCoreEnv, status: number): boolean =>
  env.KV !== undefined && !isCacheableStatus(status);

export const handleFetchSuccess = async (params: HandleFetchSuccessParams): Promise<Response> => {
  const { env, targetUrl, cacheKey, content, contentType, status, disableKv } = params;

  if (shouldCache(env, status, disableKv) && env.KV) {
    await setCachedContent({ kv: env.KV, cacheKey, data: { content, contentType } });
    logEvent(env, 'cache-set', { target: targetUrl, cacheKey });
  }

  if (!disableKv && shouldLogCacheSkip(env, status)) {
    logEvent(env, 'cache-skip', { target: targetUrl, status });
  }

  logEvent(env, 'fetch-success', { target: targetUrl, status });
  return createContentResponse({ content, contentType, cacheStatus: CACHE_MISS });
};

export const tryGetCached = async (params: TryGetCachedParams): Promise<Response | null> => {
  const { env, targetUrl, cacheKey, disableKv, disableCache } = params;

  if (disableKv || disableCache || !env.KV) {
    return null;
  }

  const cached: CachedContent | null = await getCachedContent(env.KV, cacheKey);

  if (!cached) {
    logEvent(env, 'cache-miss', { target: targetUrl, cacheKey });
    return null;
  }

  return handleCacheHit({ env, targetUrl, cacheKey, cached });
};

export const parseRequest = (request: Request): ParsedRequest => {
  const requestUrl: URL = new URL(request.url);
  const targetUrl: string | null = requestUrl.searchParams.get(QUERY_PARAM_URL);
  const disableKv: boolean = requestUrl.searchParams.get(QUERY_PARAM_DISABLE_KV) === TRUE_VALUE;
  const disableCache: boolean =
    requestUrl.searchParams.get(QUERY_PARAM_DISABLE_CACHE) === TRUE_VALUE;

  return { targetUrl, disableKv, disableCache };
};

export const validateRequest = (
  env: PlaywrightCoreEnv,
  targetUrl: string | null,
): Response | null => {
  if (!targetUrl) {
    logEvent(env, 'missing-url-query', { path: PLAYWRIGHT_PATH });
    return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
  }

  if (!isValidUrl(targetUrl)) {
    logEvent(env, 'invalid-url', { target: targetUrl });
    return createErrorResponse(ERROR_INVALID_URL, STATUS_BAD_REQUEST);
  }

  return null;
};

export const handleCoreRequest = async (params: HandleRequestParams): Promise<Response> => {
  const { env, targetUrl, cacheKey, disableKv, disableCache, fetchPage, ipRotateOptions } = params;

  const cachedResponse: Response | null = await tryGetCached({
    env,
    targetUrl,
    cacheKey,
    disableKv,
    disableCache,
  });

  if (cachedResponse) {
    return cachedResponse;
  }

  logEvent(env, 'fetch-start', { target: targetUrl });

  // Try IP rotate fetch first if configured
  if (ipRotateOptions) {
    const ipRotateResult: FetchPageResponse | null = await tryFetchWithIpRotate(
      env,
      targetUrl,
      ipRotateOptions,
    );

    if (ipRotateResult && isFetchSuccess(ipRotateResult)) {
      return handleFetchSuccess({
        env,
        targetUrl,
        cacheKey,
        content: ipRotateResult.content,
        contentType: ipRotateResult.contentType,
        status: ipRotateResult.status,
        disableKv,
      });
    }
  }

  // Fall back to browser fetch
  const result: FetchPageResponse = await fetchPage();

  if (!isFetchSuccess(result)) {
    return handleFetchError(env, targetUrl, result.error);
  }

  return handleFetchSuccess({
    env,
    targetUrl,
    cacheKey,
    content: result.content,
    contentType: result.contentType,
    status: result.status,
    disableKv,
  });
};

export const deleteKvCache = async (
  kv: KVNamespace | undefined,
  cacheKey: string,
): Promise<boolean> => {
  if (!kv) {
    return false;
  }
  const existing: string | null = await kv.get(cacheKey, 'text');
  if (!existing) {
    return false;
  }
  await kv.delete(cacheKey);
  return true;
};

export const handleDeleteRequest = async (
  request: Request,
  env: PlaywrightCoreEnv,
): Promise<Response> => {
  const { targetUrl } = parseRequest(request);

  const validationError = validateRequest(env, targetUrl);
  if (validationError) {
    return validationError;
  }

  const cacheKey: string = createCacheKey(targetUrl as string, env.CACHE_VERSION);
  const kvDeleted: boolean = await deleteKvCache(env.KV, cacheKey);
  const status: number = kvDeleted ? STATUS_OK : STATUS_NOT_FOUND;

  logEvent(env, 'cache-delete', { target: targetUrl as string, cacheKey });
  return createJsonResponse({ deleted: kvDeleted, kvDeleted }, status);
};
