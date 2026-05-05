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
  isAkamaiBlockBody,
  isHtmlContentType,
  parseRequest,
  resolveIpRotateConfigForPlaywright,
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

// Module-level cache for IP rotation config loaded from KV
const ipRotateConfigCache: Map<string, IpRotateConfig> = new Map();
const IP_ROTATE_CONFIG_KEY = 'default';

// Constants
// Worker total budget must fit within Cloudflare Workers CPU/wall-clock
// limits. Worst-case browser attempts: BROWSER_RETRY_COUNT * (BROWSER_DEFAULT_TIMEOUT_MS
// + exponential backoff up to BROWSER_RETRY_MAX_DELAY_MS). With the values
// below: 3 * (15s + up to 6s backoff) ~= 63s, leaving headroom for IP-rotate
// fallback within the CPU budget declared in wrangler.toml (cpu_ms = 300_000).
// Backoff is exponential (1s, 2s, 4s, capped) so a stalled upstream has more
// time to recover than the previous linear schedule (1s, 2s, 3s) granted.
const BROWSER_DEFAULT_TIMEOUT_MS: number = 15000;
const BROWSER_WAIT_UNTIL: WaitUntilState = 'domcontentloaded';
const BROWSER_RETRY_COUNT: number = 3;
const BROWSER_RETRY_BASE_DELAY_MS: number = 1000;
const BROWSER_RETRY_MAX_DELAY_MS: number = 6000;
const BROWSER_RETRY_BACKOFF_FACTOR: number = 2;
const BROWSER_RETRY_FIRST_ATTEMPT: number = 1;

// Load IP rotation config with module-level caching
const getOrLoadIpRotateConfig = async (
  env: PlaywrightCoreEnv,
  cache: Map<string, IpRotateConfig>,
): Promise<IpRotateConfig | undefined> => {
  const cached: IpRotateConfig | undefined = cache.get(IP_ROTATE_CONFIG_KEY);
  if (cached) return cached;

  const config: IpRotateConfig | undefined = await resolveIpRotateConfigForPlaywright(env);
  if (config) {
    cache.set(IP_ROTATE_CONFIG_KEY, config);
  }
  return config;
};

// Browser-specific functions
const getResponseContentType = (response: Awaited<ReturnType<Page['goto']>>): string =>
  response?.headers()[HEADER_CONTENT_TYPE] ?? CONTENT_TYPE_HTML;

// Cloudflare Browser sometimes returns successful navigation (status 200) but
// page.content() yields an empty string - usually because the upstream wiped
// the body via JS or the navigation completed before any HTML was parsed.
// Treat this as a transient failure so the surrounding retry loop can take
// another shot rather than caching/serving empty content.
const ERROR_EMPTY_PAGE_CONTENT: string = 'Empty page content from browser';

// Cloudflare Browser may also receive an Akamai "Access Denied" block page
// when the egress IP is on the upstream CDN's blocklist. Throw so the retry
// loop tries again with a different browser session and the block page is
// never persisted to cache.
const ERROR_AKAMAI_BLOCK_PAGE: string = 'Akamai block page returned to browser';

// Mojibake detection: even a handful of U+FFFD replacement characters in a
// CJK-only document is a strong signal that the upstream EUC-JP page was
// decoded incorrectly. The threshold is intentionally low because mojibake
// often shows up only on rare CJK characters such as horse names, while the
// surrounding HTML scaffold remains ASCII-clean and would otherwise hide
// the corruption from a higher-threshold check.
const MOJIBAKE_REPLACEMENT_THRESHOLD: number = 5;
const ERROR_MOJIBAKE_CONTENT: string = 'Mojibake content from browser';
// Use the explicit U+FFFD escape rather than the literal character to avoid
// any source-file encoding ambiguity when this code is bundled.
const REPLACEMENT_CHAR_REGEX: RegExp = /\uFFFD/g;

const countReplacementChars = (text: string): number => {
  const matches: RegExpMatchArray | null = text.match(REPLACEMENT_CHAR_REGEX);
  return matches?.length ?? 0;
};

const isMojibakeContent = (text: string): boolean =>
  countReplacementChars(text) >= MOJIBAKE_REPLACEMENT_THRESHOLD;

const readDecodedHtml = async (
  page: Page,
  response: Awaited<ReturnType<Page['goto']>>,
  contentType: string,
): Promise<string> => {
  if (!isHtmlContentType(contentType)) {
    return (await response?.text()) ?? '';
  }
  return page.content();
};

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
    const content: string = await readDecodedHtml(page, response, contentType);

    if (content.length === 0) {
      throw new Error(ERROR_EMPTY_PAGE_CONTENT);
    }

    // Akamai may serve a small "Access Denied" HTML body wrapped in a 200
    // response when the egress IP is on its blocklist. Throwing here makes
    // the retry loop (which obtains a new browser session per attempt)
    // cycle through different egress paths instead of caching the block.
    if (isAkamaiBlockBody(content)) {
      throw new Error(ERROR_AKAMAI_BLOCK_PAGE);
    }

    // Mojibake detection: Cloudflare Browser sometimes fails to decode
    // non-UTF-8 pages, leaving the content string riddled with U+FFFD. Treat
    // as failure so the retry loop tries again (a new context/session may
    // pick a different decode path) and so we don't cache mojibake.
    if (isMojibakeContent(content)) {
      throw new Error(ERROR_MOJIBAKE_CONTENT);
    }

    return { content, contentType, status };
  } finally {
    await context.close();
    await browser.close();
  }
};

const computeBrowserRetryDelay = (attempt: number): number =>
  Math.min(
    BROWSER_RETRY_BASE_DELAY_MS *
      BROWSER_RETRY_BACKOFF_FACTOR ** (attempt - BROWSER_RETRY_FIRST_ATTEMPT),
    BROWSER_RETRY_MAX_DELAY_MS,
  );

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
      await delay(computeBrowserRetryDelay(attempt));
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
export const handlePlaywrightRequest = async (
  request: Request,
  env: PlaywrightEnv,
): Promise<Response> => {
  const { targetUrl, disableKv, disableCache } = parseRequest(request);

  const validationError = validateRequest(env, targetUrl);
  if (validationError) {
    return validationError;
  }

  const cacheKey: string = createCacheKey(targetUrl as string, env.CACHE_VERSION);
  const ipRotateConfig: IpRotateConfig | undefined = await getOrLoadIpRotateConfig(
    env,
    ipRotateConfigCache,
  );
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
