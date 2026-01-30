// Playwright route for browser-based page fetching
// Used when target sites block Cloudflare Workers direct fetch
// Implements 2-level caching: KV storage with URL + date as key
// Execute with bun: wrangler dev

import type { Browser, BrowserContext, BrowserWorker, Page } from '@cloudflare/playwright';
import { launch as playwrightLaunch } from '@cloudflare/playwright';
import type { IpRotateConfig } from '../ip-rotate/types.ts';
import type { FetchPageResponse, IpRotateOptions, PlaywrightCoreEnv } from './core.ts';
import {
  CONTENT_TYPE_HTML,
  createCacheKey,
  delay,
  ERROR_UNKNOWN_FETCH,
  getErrorMessage,
  HEADER_CONTENT_TYPE,
  handleCoreRequest,
  handleDeleteRequest,
  isHtmlContentType,
  parseIpRotateConfigFromEnv,
  parseRequest,
  validateRequest,
} from './core.ts';

// Re-export for backward compatibility
export { PLAYWRIGHT_PATH } from './core.ts';
export type { PlaywrightCoreEnv };

// Interfaces
export interface PlaywrightEnv extends PlaywrightCoreEnv {
  BROWSER: BrowserWorker;
}

interface FetchPageWithRetryParams {
  browserWorker: BrowserWorker;
  url: string;
  attempt: number;
  lastError: string;
}

// Types
type WaitUntilState = 'domcontentloaded' | 'load' | 'networkidle';

// Module-level counter for IP rotation round-robin
const ipRotateCounters: Map<string, number> = new Map();

// Constants
const BROWSER_DEFAULT_TIMEOUT_MS: number = 30000;
const BROWSER_WAIT_UNTIL: WaitUntilState = 'domcontentloaded';
const BROWSER_RETRY_COUNT: number = 10;
const BROWSER_RETRY_DELAY_MS: number = 2000;

// Browser-specific functions
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

    const status: number = response?.status() ?? 200;
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

// Public API
export const handlePlaywrightRequest = (
  request: Request,
  env: PlaywrightEnv,
): Promise<Response> => {
  const { targetUrl, disableKv, disableCache } = parseRequest(request);

  const validationError = validateRequest(env, targetUrl);
  if (validationError) {
    return Promise.resolve(validationError);
  }

  const cacheKey: string = createCacheKey(targetUrl as string, env.CACHE_VERSION);
  const ipRotateConfig: IpRotateConfig | undefined = parseIpRotateConfigFromEnv(env);
  const ipRotateOptions: IpRotateOptions | undefined = ipRotateConfig
    ? { config: ipRotateConfig, counters: ipRotateCounters }
    : undefined;

  return handleCoreRequest({
    env,
    targetUrl: targetUrl as string,
    cacheKey,
    disableKv,
    disableCache,
    fetchPage: () => fetchPageWithBrowser(env.BROWSER, targetUrl as string),
    ipRotateOptions,
  });
};

export const handlePlaywrightDeleteRequest = (
  request: Request,
  env: PlaywrightEnv,
): Promise<Response> => handleDeleteRequest(request, env);
