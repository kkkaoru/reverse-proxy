// Browser service for Playwright operations
// Execute with bun: wrangler dev

import type { Browser, BrowserContext, BrowserWorker, Page } from '@cloudflare/playwright';
import {
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
  BROWSER_WAIT_UNTIL_NETWORKIDLE,
} from '../constants/index.ts';
import { convertToUtf8 } from '../utils/encoding.ts';
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
  storageState?: StorageState;
}

const UNKNOWN_ERROR_PAGE_FETCH = 'Unknown error during page fetch';
const UNKNOWN_ERROR_SIGN_IN = 'Unknown error during sign-in';

const isStorageState = (data: RawStorageState): data is StorageState =>
  Array.isArray(data.cookies) && Array.isArray(data.origins);

const convertToStorageState = (rawState: RawStorageState): StorageState => ({
  cookies: Array.isArray(rawState.cookies) ? rawState.cookies : [],
  origins: Array.isArray(rawState.origins) ? rawState.origins : [],
});

const buildContextOptions = (storageState?: StorageState): ContextOptions =>
  storageState ? { storageState } : {};

export const fetchPage = async (
  params: FetchPageParams,
): Promise<FetchPageResult | FetchPageError> => {
  const contextOptions: ContextOptions = buildContextOptions(params.storageState);

  try {
    const browser: Browser = await launchBrowser(params.browserWorker);
    const context: BrowserContext = await browser.newContext(contextOptions);
    const page: Page = await context.newPage();

    await page.goto(params.url, {
      waitUntil: BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    });

    const rawHtml: string = await page.content();
    const html: string = convertToUtf8(rawHtml);
    const rawStorageState = await context.storageState();
    const storageState: StorageState = convertToStorageState(rawStorageState);

    await context.close();
    await browser.close();

    return { html, storageState };
  } catch (error) {
    const errorMessage: string = error instanceof Error ? error.message : UNKNOWN_ERROR_PAGE_FETCH;
    return { error: true, errorMessage };
  }
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

    await page.waitForLoadState(BROWSER_WAIT_UNTIL_NETWORKIDLE, {
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    });

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
  return isStorageState(parsed) ? parsed : { cookies: [], origins: [] };
};
