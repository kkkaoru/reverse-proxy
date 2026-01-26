// Playwright route for browser-based page fetching
// Used when target sites block Cloudflare Workers direct fetch
// Implements 2-level caching: KV storage with URL + date as key
// Execute with bun: wrangler dev

import type { Browser, BrowserContext, BrowserWorker, Page } from '@cloudflare/playwright';
import { launch as playwrightLaunch } from '@cloudflare/playwright';

// Interfaces
export interface PlaywrightEnv {
  BROWSER: BrowserWorker;
  KV?: KVNamespace;
  LOG_REQUESTS?: string;
  CACHE_VERSION: string;
}

interface FetchPageResult {
  content: string;
  contentType: string;
  status: number;
  error?: never;
}

interface FetchPageError {
  html?: never;
  error: string;
}

interface CachedContent {
  content: string;
  contentType: string;
}

interface SetCachedContentParams {
  kv: KVNamespace;
  cacheKey: string;
  data: CachedContent;
}

interface LogEventDetail {
  path?: string;
  target?: string;
  cacheKey?: string;
  error?: string;
  status?: number;
}

interface HandleCacheHitParams {
  env: PlaywrightEnv;
  targetUrl: string;
  cacheKey: string;
  cached: CachedContent;
}

interface HandleFetchSuccessParams {
  env: PlaywrightEnv;
  targetUrl: string;
  cacheKey: string;
  content: string;
  contentType: string;
  status: number;
  disableKv: boolean;
}

interface TryGetCachedParams {
  env: PlaywrightEnv;
  targetUrl: string;
  cacheKey: string;
  disableKv: boolean;
  disableCache: boolean;
}

interface FetchPageWithRetryParams {
  browserWorker: BrowserWorker;
  url: string;
  attempt: number;
  lastError: string;
}

interface CreateContentResponseParams {
  content: string;
  contentType: string;
  cacheStatus: string;
}

// Types
type FetchPageResponse = FetchPageResult | FetchPageError;
type WaitUntilState = 'domcontentloaded' | 'load' | 'networkidle';

// Type guards
const isFetchSuccess = (result: FetchPageResponse): result is FetchPageResult =>
  result.error === undefined;

const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

// Constants
const BROWSER_DEFAULT_TIMEOUT_MS: number = 30000;
const BROWSER_WAIT_UNTIL: WaitUntilState = 'domcontentloaded';
const BROWSER_RETRY_COUNT: number = 10;
const BROWSER_RETRY_DELAY_MS: number = 2000;
const QUERY_PARAM_URL: string = 'url';
const QUERY_PARAM_DISABLE_KV: string = 'disable_kv';
const QUERY_PARAM_DISABLE_CACHE: string = 'disable_cache';
const TRUE_VALUE: string = 'true';
const STATUS_OK: number = 200;
const STATUS_BAD_REQUEST: number = 400;
const STATUS_CLIENT_ERROR_START: number = 400;
const STATUS_BAD_GATEWAY: number = 502;
const HEADER_CONTENT_TYPE: string = 'content-type';
const HEADER_X_CACHE: string = 'x-cache';
const CONTENT_TYPE_HTML: string = 'text/html; charset=utf-8';
const CONTENT_TYPE_JSON: string = 'application/json; charset=utf-8';
const CONTENT_TYPE_HTML_PREFIX: string = 'text/html';
const CACHE_TTL_SECONDS: number = 432000; // 5 days (86400 * 5)
const CACHE_HIT: string = 'HIT';
const CACHE_MISS: string = 'MISS';
const LOG_PREFIX: string = '[reverse-proxy-playwright]';
const ERROR_MISSING_URL: string = 'Query parameter "url" is required.';
const ERROR_INVALID_URL: string = 'Query parameter "url" must be a valid absolute URL.';
const ERROR_UNKNOWN_FETCH: string = 'Unknown error during page fetch';
const LOG_REQUESTS_ENABLED: string = 'TRUE';

export const PLAYWRIGHT_PATH: string = '/playwright';

// Functions
const isLoggingEnabled = (env: PlaywrightEnv): boolean =>
  env.LOG_REQUESTS?.toUpperCase() === LOG_REQUESTS_ENABLED;

const logEvent = (env: PlaywrightEnv, event: string, detail: LogEventDetail): void => {
  if (!isLoggingEnabled(env)) {
    return;
  }
  // biome-ignore lint/suspicious/noConsole: explicit logging requested for observability.
  console.log(LOG_PREFIX, event, detail);
};

const createContentResponse = (params: CreateContentResponseParams): Response =>
  new Response(params.content, {
    status: STATUS_OK,
    headers: {
      [HEADER_CONTENT_TYPE]: params.contentType,
      [HEADER_X_CACHE]: params.cacheStatus,
    },
  });

const createErrorResponse = (message: string, status: number): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

const createCacheKey = (url: string, cacheVersion: string): string =>
  `playwright-${cacheVersion}::${url}`;

const parseCachedContent = (cached: string): CachedContent => JSON.parse(cached);

const getCachedContent = async (
  kv: KVNamespace,
  cacheKey: string,
): Promise<CachedContent | null> => {
  const cached: string | null = await kv.get(cacheKey, 'text');

  if (!cached) {
    return null;
  }

  return parseCachedContent(cached);
};

const setCachedContent = (params: SetCachedContentParams): Promise<void> =>
  params.kv.put(params.cacheKey, JSON.stringify(params.data), { expirationTtl: CACHE_TTL_SECONDS });

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ERROR_UNKNOWN_FETCH;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isHtmlContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith(CONTENT_TYPE_HTML_PREFIX);

const getResponseContentType = (response: Awaited<ReturnType<Page['goto']>>): string =>
  response?.headers()[HEADER_CONTENT_TYPE] ?? CONTENT_TYPE_HTML;

const fetchPageOnce = async (
  browserWorker: BrowserWorker,
  url: string,
): Promise<FetchPageResponse> => {
  const browser: Browser = await playwrightLaunch(browserWorker);
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: BROWSER_WAIT_UNTIL,
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    });

    const status: number = response?.status() ?? STATUS_OK;
    const contentType: string = getResponseContentType(response);
    const content: string = isHtmlContentType(contentType)
      ? await page.content()
      : ((await response?.text()) ?? '');

    return { content, contentType, status };
  } finally {
    await context.close();
    await browser.close();
  }
};

const fetchPageWithRetry = async (params: FetchPageWithRetryParams): Promise<FetchPageResponse> => {
  const { browserWorker, url, attempt, lastError } = params;

  if (attempt > BROWSER_RETRY_COUNT) {
    return { error: lastError };
  }

  try {
    return await fetchPageOnce(browserWorker, url);
  } catch (error: unknown) {
    const errorMessage: string = getErrorMessage(error);

    if (attempt < BROWSER_RETRY_COUNT) {
      await delay(BROWSER_RETRY_DELAY_MS * attempt);
    }

    return fetchPageWithRetry({
      browserWorker,
      url,
      attempt: attempt + 1,
      lastError: errorMessage,
    });
  }
};

const fetchPageWithBrowser = (
  browserWorker: BrowserWorker,
  url: string,
): Promise<FetchPageResponse> =>
  fetchPageWithRetry({
    browserWorker,
    url,
    attempt: 1,
    lastError: ERROR_UNKNOWN_FETCH,
  });

const handleCacheHit = (params: HandleCacheHitParams): Response => {
  logEvent(params.env, 'cache-hit', { target: params.targetUrl, cacheKey: params.cacheKey });
  return createContentResponse({
    content: params.cached.content,
    contentType: params.cached.contentType,
    cacheStatus: CACHE_HIT,
  });
};

const handleFetchError = (
  env: PlaywrightEnv,
  targetUrl: string,
  errorMessage: string,
): Response => {
  logEvent(env, 'fetch-error', { target: targetUrl, error: errorMessage });
  return createErrorResponse(`Browser fetch failed: ${errorMessage}`, STATUS_BAD_GATEWAY);
};

const shouldCache = (env: PlaywrightEnv, status: number, disableKv: boolean): boolean =>
  !disableKv && env.KV !== undefined && isCacheableStatus(status);

const shouldLogCacheSkip = (env: PlaywrightEnv, status: number): boolean =>
  env.KV !== undefined && !isCacheableStatus(status);

const handleFetchSuccess = async (params: HandleFetchSuccessParams): Promise<Response> => {
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

const tryGetCached = async (params: TryGetCachedParams): Promise<Response | null> => {
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

export const handlePlaywrightRequest = async (
  request: Request,
  env: PlaywrightEnv,
): Promise<Response> => {
  const requestUrl: URL = new URL(request.url);
  const targetUrl: string | null = requestUrl.searchParams.get(QUERY_PARAM_URL);
  const disableKv: boolean = requestUrl.searchParams.get(QUERY_PARAM_DISABLE_KV) === TRUE_VALUE;
  const disableCache: boolean =
    requestUrl.searchParams.get(QUERY_PARAM_DISABLE_CACHE) === TRUE_VALUE;

  if (!targetUrl) {
    logEvent(env, 'missing-url-query', { path: PLAYWRIGHT_PATH });
    return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
  }

  if (!isValidUrl(targetUrl)) {
    logEvent(env, 'invalid-url', { target: targetUrl });
    return createErrorResponse(ERROR_INVALID_URL, STATUS_BAD_REQUEST);
  }

  const cacheKey: string = createCacheKey(targetUrl, env.CACHE_VERSION);
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
  const result: FetchPageResponse = await fetchPageWithBrowser(env.BROWSER, targetUrl);

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
