// Browser service for Playwright operations
// Execute with bun: wrangler dev

import type { Browser, BrowserContext, BrowserWorker, Page } from '@cloudflare/playwright';
import {
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_USER_AGENT,
  BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
  EMPTY_PAGE_CONTENT_ERROR,
  FETCH_PAGE_RETRY_BASE_DELAY_MS,
  FETCH_PAGE_RETRY_COUNT,
} from '../constants/index.ts';
import { AKAMAI_BLOCK_PAGE_ERROR, isAkamaiBlockBody } from '../utils/akamai.ts';
// Note: Playwright handles encoding automatically via browser engine
import { launchBrowser } from './browser-launcher.ts';

type SameSiteValue = 'Strict' | 'Lax' | 'None';

interface StorageState {
  cookies: CookieData[];
  origins: OriginData[];
}

interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSiteValue;
}

interface OriginData {
  origin: string;
  localStorage: LocalStorageEntry[];
}

interface LocalStorageEntry {
  name: string;
  value: string;
}

interface FetchPageParams {
  browserWorker: BrowserWorker;
  url: string;
  storageState?: StorageState;
}

interface FetchPageResult {
  html: string;
  storageState: StorageState;
}

interface SignInParams {
  browserWorker: BrowserWorker;
  signInUrl: string;
  userIdSelector: string;
  passwordSelector: string;
  signInButtonSelector: string;
  userId: string;
  password: string;
  storageState?: StorageState;
}

interface SignInResult {
  success: boolean;
  storageState: StorageState;
  errorMessage?: string;
}

interface FetchPageError {
  error: true;
  errorMessage: string;
}

interface RawStorageState {
  cookies?: unknown;
  origins?: unknown;
}

interface ContextOptions {
  locale?: string;
  storageState?: StorageState;
  timezoneId?: string;
  userAgent?: string;
}

const UNKNOWN_ERROR_PAGE_FETCH = 'Unknown error during page fetch';
const UNKNOWN_ERROR_SIGN_IN = 'Unknown error during sign-in';
const BROWSER_LOCALE = 'ja-JP';
const BROWSER_TIMEZONE_ID = 'Asia/Tokyo';

const isStorageState = (data: RawStorageState): data is StorageState =>
  Array.isArray(data.cookies) && Array.isArray(data.origins);

// netkeiba sometimes sets session cookies host-only on `race.netkeiba.com`
// (no Domain attribute). Without rewriting, a JRA sign-in never
// authenticates `nar.netkeiba.com` even though both share the same
// account. Broadening any `*.netkeiba.com` host-only cookie to the
// parent `.netkeiba.com` makes the storage state reusable across
// subdomains; safe because the browser only accepts the broadening
// when the saving host is itself under that scope.
const NETKEIBA_COOKIE_HOST_SUFFIX = '.netkeiba.com';
const NETKEIBA_COOKIE_DOMAIN = '.netkeiba.com';

const normalizeNetkeibaCookieDomain = (cookie: CookieData): CookieData => {
  const hostname = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  if (hostname !== 'netkeiba.com' && !hostname.endsWith(NETKEIBA_COOKIE_HOST_SUFFIX)) {
    return cookie;
  }
  if (cookie.domain === NETKEIBA_COOKIE_DOMAIN) {
    return cookie;
  }
  return { ...cookie, domain: NETKEIBA_COOKIE_DOMAIN };
};

const broadenStorageStateCookies = (cookies: CookieData[]): CookieData[] =>
  cookies.map(normalizeNetkeibaCookieDomain);

const convertToStorageState = (rawState: RawStorageState): StorageState => ({
  cookies: Array.isArray(rawState.cookies) ? broadenStorageStateCookies(rawState.cookies) : [],
  origins: Array.isArray(rawState.origins) ? rawState.origins : [],
});

const buildContextOptions = (storageState?: StorageState): ContextOptions => ({
  locale: BROWSER_LOCALE,
  timezoneId: BROWSER_TIMEZONE_ID,
  userAgent: BROWSER_USER_AGENT,
  ...(storageState ? { storageState } : {}),
});

const cookieAppliesToHostname = (cookie: CookieData, hostname: string): boolean => {
  const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`);
};

const cookieAppliesToPath = (cookiePath: string, urlPath: string): boolean => {
  if (cookiePath === '/' || cookiePath === urlPath) {
    return true;
  }
  if (!urlPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith('/') || urlPath.charAt(cookiePath.length) === '/';
};

// Cloudflare Browser Rendering's Playwright integration restores
// storageState cookies into its internal jar, but in practice the jar
// doesn't always emit those cookies for cross-subdomain navigations
// — a `.netkeiba.com` cookie loaded from a JRA sign-in is silently
// dropped when navigating to `nar.netkeiba.com`, even though a plain
// curl with the same cookies authenticates successfully. As a
// belt-and-suspenders mitigation, project the storage state into a
// `Cookie` header that Chromium sends verbatim via
// `extraHTTPHeaders`, in addition to whatever the cookie jar adds.
export const buildCookieHeaderForUrl = (cookies: CookieData[], url: string): string | null => {
  const parsed = ((): URL | null => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return null;
  }
  const isSecureRequest = parsed.protocol === 'https:';
  const hostname = parsed.hostname;
  const urlPath = parsed.pathname || '/';
  const matching = cookies.filter(
    (cookie) =>
      cookieAppliesToHostname(cookie, hostname) &&
      cookieAppliesToPath(cookie.path, urlPath) &&
      (!cookie.secure || isSecureRequest),
  );
  if (matching.length === 0) {
    return null;
  }
  return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Sessions are shared (see browser-launcher.ts), so a session that just
// failed (Akamai block, timeout, empty page) must not be handed to the next
// request. browser.close() only disconnects a connect()ed browser; ask
// Chromium itself to exit. Best effort: an un-killed session still idles out
// after keep_alive.
const discardSession = async (browser: Browser): Promise<void> => {
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.close');
  } catch {
    // Already gone or not supported: nothing more to do.
  }
};

const fetchPageOnce = async (
  params: FetchPageParams,
  contextOptions: ContextOptions,
  fresh: boolean,
): Promise<FetchPageResult> => {
  const browser: Browser = await launchBrowser(params.browserWorker, { fresh });
  let succeeded = false;
  try {
    const context: BrowserContext = await browser.newContext(contextOptions);
    try {
      const cookieHeader = contextOptions.storageState
        ? buildCookieHeaderForUrl(contextOptions.storageState.cookies, params.url)
        : null;
      if (cookieHeader) {
        await context.setExtraHTTPHeaders({ Cookie: cookieHeader });
      }
      const page: Page = await context.newPage();
      await page.goto(params.url, {
        waitUntil: BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
        timeout: BROWSER_DEFAULT_TIMEOUT_MS,
      });
      const html: string = await page.content();
      if (html.length === 0) {
        throw new Error(EMPTY_PAGE_CONTENT_ERROR);
      }
      if (isAkamaiBlockBody(html)) {
        throw new Error(AKAMAI_BLOCK_PAGE_ERROR);
      }
      const rawStorageState = await context.storageState();
      const storageState: StorageState = convertToStorageState(rawStorageState);
      succeeded = true;
      return { html, storageState };
    } finally {
      await context.close();
    }
  } finally {
    if (!succeeded) {
      await discardSession(browser);
    }
    await browser.close().catch(() => undefined);
  }
};

interface AttemptFetchPageParams {
  params: FetchPageParams;
  contextOptions: ContextOptions;
  attempt: number;
  lastError: string;
}

const attemptFetchPage = async (
  args: AttemptFetchPageParams,
): Promise<FetchPageResult | FetchPageError> => {
  if (args.attempt > FETCH_PAGE_RETRY_COUNT) {
    return { error: true, errorMessage: args.lastError };
  }
  try {
    // Retries always take a fresh session instead of a possibly bad warm one.
    return await fetchPageOnce(args.params, args.contextOptions, args.attempt > 1);
  } catch (error) {
    const errorMessage: string = error instanceof Error ? error.message : UNKNOWN_ERROR_PAGE_FETCH;
    if (args.attempt < FETCH_PAGE_RETRY_COUNT) {
      await sleep(FETCH_PAGE_RETRY_BASE_DELAY_MS * args.attempt);
    }
    return attemptFetchPage({
      params: args.params,
      contextOptions: args.contextOptions,
      attempt: args.attempt + 1,
      lastError: errorMessage,
    });
  }
};

export const fetchPage = (params: FetchPageParams): Promise<FetchPageResult | FetchPageError> =>
  attemptFetchPage({
    params,
    contextOptions: buildContextOptions(params.storageState),
    attempt: 1,
    lastError: UNKNOWN_ERROR_PAGE_FETCH,
  });

const waitForPostSignInNavigation = async (page: Page): Promise<void> => {
  await page
    .waitForLoadState(BROWSER_WAIT_UNTIL_DOMCONTENTLOADED, {
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    })
    .catch(() => undefined);
};

export const performSignIn = async (params: SignInParams): Promise<SignInResult> => {
  const contextOptions: ContextOptions = buildContextOptions(params.storageState);

  const browser: Browser = await launchBrowser(params.browserWorker);
  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();

  try {
    await page.goto(params.signInUrl, {
      waitUntil: BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    });

    await page.fill(params.userIdSelector, params.userId);
    await page.fill(params.passwordSelector, params.password);
    await page.click(params.signInButtonSelector);

    await waitForPostSignInNavigation(page);

    const rawState = await context.storageState();
    const storageState: StorageState = convertToStorageState(rawState);
    await context.close();
    await browser.close();

    return { success: true, storageState };
  } catch (error) {
    const rawStateOnError = await context.storageState();
    const storageState: StorageState = convertToStorageState(rawStateOnError);
    await context.close();
    await browser.close();

    const errorMessage: string = error instanceof Error ? error.message : UNKNOWN_ERROR_SIGN_IN;
    return { success: false, storageState, errorMessage };
  }
};

export const serializeStorageState = (state: StorageState): string => JSON.stringify(state);

export const deserializeStorageState = (json: string): StorageState => {
  const parsed: RawStorageState = JSON.parse(json);
  if (!isStorageState(parsed)) {
    return { cookies: [], origins: [] };
  }
  // Also broaden on read so legacy KV entries (saved before this
  // normalization existed) authenticate sibling subdomains immediately.
  return { cookies: broadenStorageStateCookies(parsed.cookies), origins: parsed.origins };
};
