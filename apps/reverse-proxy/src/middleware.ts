// Proxy cache middleware for reverse proxy
// Execute with bun: wrangler dev

import type { Context, MiddlewareHandler, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { convertResponseToUtf8 } from './encoding.ts';

// Interfaces
export interface ProxyCacheStaticOptions {
  enableLogging: boolean;
}

export interface ProxyCacheEnv {
  KV?: KVNamespace;
  CACHE_VERSION?: string;
}

interface ProxyCacheOptions {
  enableLogging: boolean;
  kv?: KVNamespace;
  cacheVersion: string;
}

interface CachedContent {
  content: string;
  contentType: string;
}

interface SetKvCacheParams {
  kv: KVNamespace;
  cacheKey: string;
  data: CachedContent;
}

interface ParsedUrlSuccess {
  success: true;
  value: URL;
}

interface ParsedUrlFailure {
  success: false;
  message: string;
}

interface FetchAndCacheParams {
  cacheKey: string;
  kvCacheKey: string;
  target: URL;
  options: ProxyCacheOptions;
}

interface LogEventDetail {
  target?: string;
  finalUrl?: string;
  status?: number;
  body?: string;
  error?: string;
  deleted?: boolean;
  method?: string;
  cacheKey?: string;
}

interface LogUpstreamErrorParams {
  options: ProxyCacheOptions;
  target: URL;
  currentUrl: string;
  response: Response;
}

interface ProcessFetchResponseParams {
  params: FetchAndCacheParams;
  response: Response;
  currentUrl: string;
}

// Types
type ParsedUrl = ParsedUrlSuccess | ParsedUrlFailure;
type RequestHandler = (target: string) => Promise<Response>;

// Constants
const ROOT_PATH: string = '/';
const QUERY_KEY_TARGET: string = 'url';
const METHOD_GET: string = 'GET';
const METHOD_DELETE: string = 'DELETE';
const CACHE_MODE_NO_STORE: RequestCache = 'no-store';
const REDIRECT_MANUAL: RequestRedirect = 'manual';
const HEADER_CONTENT_TYPE: string = 'content-type';
const HEADER_USER_AGENT: string = 'user-agent';
const HEADER_ACCEPT: string = 'accept';
const HEADER_ACCEPT_LANGUAGE: string = 'accept-language';
const HEADER_ACCEPT_ENCODING: string = 'accept-encoding';
const HEADER_REFERER: string = 'referer';
const HEADER_CONNECTION: string = 'connection';
const HEADER_UPGRADE_INSECURE_REQUESTS: string = 'upgrade-insecure-requests';
const HEADER_SEC_FETCH_DEST: string = 'sec-fetch-dest';
const HEADER_SEC_FETCH_MODE: string = 'sec-fetch-mode';
const HEADER_SEC_FETCH_SITE: string = 'sec-fetch-site';
const HEADER_SEC_FETCH_USER: string = 'sec-fetch-user';
const HEADER_LOCATION: string = 'location';
const HEADER_SET_COOKIE: string = 'set-cookie';
const DEFAULT_USER_AGENT: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT: string = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const DEFAULT_ACCEPT_LANGUAGE: string = 'ja,en-US;q=0.9,en;q=0.8';
const DEFAULT_ACCEPT_ENCODING: string = 'gzip, deflate, br';
const CONTENT_TYPE_JSON: string = 'application/json; charset=utf-8';
const CONNECTION_KEEP_ALIVE: string = 'keep-alive';
const SEC_FETCH_DEST_DOCUMENT: string = 'document';
const SEC_FETCH_MODE_NAVIGATE: string = 'navigate';
const SEC_FETCH_SITE_NONE: string = 'none';
const SEC_FETCH_USER_TRUE: string = '?1';
const UPGRADE_INSECURE_TRUE: string = '1';
const STATUS_OK: number = 200;
const STATUS_REDIRECT_START: number = 300;
const STATUS_REDIRECT_END: number = 400;
const STATUS_BAD_REQUEST: number = 400;
const STATUS_NOT_FOUND: number = 404;
const STATUS_CLIENT_ERROR_START: number = 400;
const STATUS_BAD_GATEWAY: number = 502;
const MAX_REDIRECTS: number = 10;
const ERROR_BODY_SLICE_LENGTH: number = 500;
const ERROR_MISSING_URL: string = 'Query parameter "url" is required.';
const ERROR_INVALID_URL: string = 'Query parameter "url" must be a valid absolute URL.';
const ERROR_TOO_MANY_REDIRECTS: string = 'Too many redirects';
const ERROR_UNKNOWN_FETCH: string = 'Unknown fetch error';
const LOG_PREFIX: string = '[reverse-proxy]';
const LOG_EVENT_CACHE_HIT: string = 'cache-hit';
const LOG_EVENT_CACHE_MISS: string = 'cache-miss';
const LOG_EVENT_FETCH_STATUS: string = 'fetch-status';
const LOG_EVENT_DELETE: string = 'cache-delete';
const LOG_EVENT_INVALID_URL: string = 'invalid-url';
const LOG_EVENT_MISSING_QUERY: string = 'missing-url-query';
const LOG_EVENT_FETCH_ERROR: string = 'fetch-error';
const LOG_EVENT_UPSTREAM_ERROR: string = 'upstream-error';
const LOG_EVENT_KV_CACHE_HIT: string = 'kv-cache-hit';
const LOG_EVENT_KV_CACHE_MISS: string = 'kv-cache-miss';
const LOG_EVENT_KV_CACHE_SET: string = 'kv-cache-set';
const CACHE_TTL_SECONDS: number = 432000; // 5 days (86400 * 5)
const KV_CACHE_KEY_PREFIX: string = 'proxy';
const DEFAULT_CACHE_VERSION: string = 'v1';

// Functions
const logEvent = (options: ProxyCacheOptions, message: string, detail: LogEventDetail): void => {
  if (!options.enableLogging) {
    return;
  }
  // biome-ignore lint/suspicious/noConsole: explicit logging requested for observability.
  console.log(LOG_PREFIX, message, detail);
};

const createJsonResponse = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

const createErrorResponse = (message: string, status: number): Response =>
  createJsonResponse({ error: message }, status);

const parseTargetUrl = (raw: string): ParsedUrl => {
  try {
    return { success: true, value: new URL(raw) };
  } catch {
    return { success: false, message: ERROR_INVALID_URL };
  }
};

const formatKeyDate = (date: Date): string => {
  const [datePart] = date.toISOString().split('T');
  return datePart ?? '';
};

const createCacheKey = (target: URL, date: Date): string =>
  `${target.toString()}::${formatKeyDate(date)}`;

const createKvCacheKey = (url: string, cacheVersion: string): string =>
  `${KV_CACHE_KEY_PREFIX}-${cacheVersion}::${url}`;

const parseKvCachedContent = (cached: string): CachedContent => JSON.parse(cached);

const getKvCachedContent = async (
  kv: KVNamespace,
  cacheKey: string,
): Promise<CachedContent | null> => {
  const cached: string | null = await kv.get(cacheKey, 'text');
  return cached ? parseKvCachedContent(cached) : null;
};

const setKvCachedContent = (params: SetKvCacheParams): Promise<void> =>
  params.kv.put(params.cacheKey, JSON.stringify(params.data), { expirationTtl: CACHE_TTL_SECONDS });

const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

const isRedirectStatus = (status: number): boolean =>
  status >= STATUS_REDIRECT_START && status < STATUS_REDIRECT_END;

const buildFetchHeaders = (targetOrigin: string): Record<string, string> => ({
  [HEADER_USER_AGENT]: DEFAULT_USER_AGENT,
  [HEADER_ACCEPT]: DEFAULT_ACCEPT,
  [HEADER_ACCEPT_LANGUAGE]: DEFAULT_ACCEPT_LANGUAGE,
  [HEADER_ACCEPT_ENCODING]: DEFAULT_ACCEPT_ENCODING,
  [HEADER_REFERER]: targetOrigin,
  [HEADER_CONNECTION]: CONNECTION_KEEP_ALIVE,
  [HEADER_UPGRADE_INSECURE_REQUESTS]: UPGRADE_INSECURE_TRUE,
  [HEADER_SEC_FETCH_DEST]: SEC_FETCH_DEST_DOCUMENT,
  [HEADER_SEC_FETCH_MODE]: SEC_FETCH_MODE_NAVIGATE,
  [HEADER_SEC_FETCH_SITE]: SEC_FETCH_SITE_NONE,
  [HEADER_SEC_FETCH_USER]: SEC_FETCH_USER_TRUE,
});

const sanitizeResponseHeaders = (response: Response): Headers => {
  const headers: Headers = new Headers(response.headers);
  headers.delete(HEADER_SET_COOKIE);
  return headers;
};

const cacheResponse = async (cacheKey: string, response: Response): Promise<void> => {
  const responseForCache: Response = response.clone();
  const cacheable: Response = new Response(responseForCache.body, {
    headers: sanitizeResponseHeaders(responseForCache),
    status: responseForCache.status,
    statusText: responseForCache.statusText,
  });
  await caches.default.put(cacheKey, cacheable);
};

const logUpstreamError = async (params: LogUpstreamErrorParams): Promise<void> => {
  const errorBody: string = await params.response.clone().text();
  logEvent(params.options, LOG_EVENT_UPSTREAM_ERROR, {
    target: params.target.toString(),
    finalUrl: params.currentUrl,
    status: params.response.status,
    body: errorBody.slice(0, ERROR_BODY_SLICE_LENGTH),
  });
};

const handleRedirect = (response: Response, currentUrl: string): string | null => {
  const location: string | null = response.headers.get(HEADER_LOCATION);
  return location ? new URL(location, currentUrl).toString() : null;
};

const createTooManyRedirectsResponse = (options: ProxyCacheOptions, target: URL): Response => {
  logEvent(options, LOG_EVENT_UPSTREAM_ERROR, {
    target: target.toString(),
    error: ERROR_TOO_MANY_REDIRECTS,
  });
  return createErrorResponse(ERROR_TOO_MANY_REDIRECTS, STATUS_BAD_GATEWAY);
};

const storeInKvCache = async (params: FetchAndCacheParams, response: Response): Promise<void> => {
  if (!params.options.kv) {
    return;
  }

  const content: string = await response.clone().text();
  const contentType: string = response.headers.get(HEADER_CONTENT_TYPE) ?? '';

  await setKvCachedContent({
    kv: params.options.kv,
    cacheKey: params.kvCacheKey,
    data: { content, contentType },
  });

  logEvent(params.options, LOG_EVENT_KV_CACHE_SET, {
    target: params.target.toString(),
    cacheKey: params.kvCacheKey,
  });
};

const processFetchResponse = async (
  processParams: ProcessFetchResponseParams,
): Promise<Response> => {
  const { params, response, currentUrl } = processParams;

  if (!isCacheableStatus(response.status)) {
    await logUpstreamError({
      options: params.options,
      target: params.target,
      currentUrl,
      response,
    });
    return response;
  }

  await cacheResponse(params.cacheKey, response);
  await storeInKvCache(params, response);
  return response;
};

const fetchAndCache = async (params: FetchAndCacheParams): Promise<Response> => {
  const headers: Record<string, string> = buildFetchHeaders(params.target.origin);
  let currentUrl: string = params.target.toString();
  let redirectCount: number = 0;

  while (redirectCount < MAX_REDIRECTS) {
    // biome-ignore lint/performance/noAwaitInLoops: Sequential redirects require await in loop
    const response: Response = await globalThis.fetch(currentUrl, {
      cache: CACHE_MODE_NO_STORE,
      headers,
      redirect: REDIRECT_MANUAL,
    });

    if (!isRedirectStatus(response.status)) {
      return processFetchResponse({ params, response, currentUrl });
    }

    const redirectUrl: string | null = handleRedirect(response, currentUrl);
    if (!redirectUrl) {
      return processFetchResponse({ params, response, currentUrl });
    }

    currentUrl = redirectUrl;
    redirectCount++;
  }

  return createTooManyRedirectsResponse(params.options, params.target);
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ERROR_UNKNOWN_FETCH;

const createKvCacheResponse = (cached: CachedContent): Response =>
  new Response(cached.content, {
    status: STATUS_OK,
    headers: { [HEADER_CONTENT_TYPE]: cached.contentType },
  });

const tryGetKvCache = async (
  options: ProxyCacheOptions,
  target: string,
  kvCacheKey: string,
): Promise<Response | null> => {
  if (!options.kv) {
    return null;
  }

  const cached: CachedContent | null = await getKvCachedContent(options.kv, kvCacheKey);

  if (!cached) {
    logEvent(options, LOG_EVENT_KV_CACHE_MISS, { target, cacheKey: kvCacheKey });
    return null;
  }

  logEvent(options, LOG_EVENT_KV_CACHE_HIT, { target, cacheKey: kvCacheKey });
  return createKvCacheResponse(cached);
};

const handleProxyRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed: ParsedUrl = parseTargetUrl(target);

  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }

  const kvCacheKey: string = createKvCacheKey(parsed.value.toString(), options.cacheVersion);
  const kvCached: Response | null = await tryGetKvCache(options, target, kvCacheKey);

  if (kvCached) {
    return convertResponseToUtf8(kvCached);
  }

  const cacheKey: string = createCacheKey(parsed.value, new Date());
  const cached: Response | undefined = await caches.default.match(cacheKey);

  if (cached) {
    logEvent(options, LOG_EVENT_CACHE_HIT, { target });
    return convertResponseToUtf8(cached.clone());
  }

  logEvent(options, LOG_EVENT_CACHE_MISS, { target });

  try {
    const upstreamResponse: Response = await fetchAndCache({
      cacheKey,
      kvCacheKey,
      target: parsed.value,
      options,
    });
    logEvent(options, LOG_EVENT_FETCH_STATUS, { target, status: upstreamResponse.status });
    return convertResponseToUtf8(upstreamResponse);
  } catch (error: unknown) {
    const message: string = getErrorMessage(error);
    logEvent(options, LOG_EVENT_FETCH_ERROR, { target, error: message });
    return createErrorResponse(`Upstream fetch failed: ${message}`, STATUS_BAD_GATEWAY);
  }
};

const handleDeleteRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed: ParsedUrl = parseTargetUrl(target);

  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }

  const cacheKey: string = createCacheKey(parsed.value, new Date());
  const deleted: boolean = await caches.default.delete(cacheKey);
  const status: number = deleted ? STATUS_OK : STATUS_NOT_FOUND;

  logEvent(options, LOG_EVENT_DELETE, { target, deleted });
  return createJsonResponse({ deleted }, status);
};

const createHandlerMap = (options: ProxyCacheOptions): Record<string, RequestHandler> => ({
  [METHOD_GET]: (target: string): Promise<Response> => handleProxyRequest(target, options),
  [METHOD_DELETE]: (target: string): Promise<Response> => handleDeleteRequest(target, options),
});

const createOptionsFromEnv = (
  staticOptions: ProxyCacheStaticOptions,
  env: ProxyCacheEnv,
): ProxyCacheOptions => ({
  enableLogging: staticOptions.enableLogging,
  kv: env.KV,
  cacheVersion: env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
});

export const createProxyCacheMiddleware = (
  staticOptions: ProxyCacheStaticOptions,
): MiddlewareHandler =>
  createMiddleware(async (c: Context<{ Bindings: ProxyCacheEnv }>, next: Next) => {
    if (c.req.path !== ROOT_PATH) {
      await next();
      return;
    }

    const options: ProxyCacheOptions = createOptionsFromEnv(staticOptions, c.env);
    const handlers: Record<string, RequestHandler> = createHandlerMap(options);
    const handler: RequestHandler | undefined = handlers[c.req.method];

    if (!handler) {
      await next();
      return;
    }

    const target: string | undefined = c.req.query(QUERY_KEY_TARGET);

    if (!target) {
      logEvent(options, LOG_EVENT_MISSING_QUERY, { method: c.req.method });
      return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
    }

    return handler(target);
  });
