// Sign-in flow orchestration service
// Execute with bun: wrangler dev

import type { Browser, BrowserWorker } from '@cloudflare/playwright';
import type { D1Database } from '@cloudflare/workers-types';
import { findSignInSelectorByDomain } from '../repositories/sign-in-selectors.ts';
import { findSignedInValidationByDomain } from '../repositories/signed-in-validation.ts';
import {
  deserializeStorageState,
  fetchPage,
  performSignIn,
  serializeStorageState,
} from './browser.ts';
import { launchBrowser } from './browser-launcher.ts';
import { checkSignedIn } from './validation.ts';

interface SignInFlowParams {
  browserWorker: BrowserWorker;
  db: D1Database;
  kv: KVNamespace;
  domain: string;
  userId: string;
  password: string;
}

interface SignInFlowResult {
  success: boolean;
  errorMessage?: string;
}

interface FetchWithSignInParams {
  browserWorker: BrowserWorker;
  db: D1Database;
  kv: KVNamespace;
  url: string;
  userId: string;
  password: string;
}

interface FetchWithSignInResult {
  html: string;
  signedIn: boolean;
  errorMessage?: string;
}

const STORAGE_STATE_KEY_PREFIX = 'storage-state';

const buildStorageStateKey = (domain: string, userId: string): string =>
  `${STORAGE_STATE_KEY_PREFIX}::${domain}::${userId}`;

export const executeSignInFlow = async (params: SignInFlowParams): Promise<SignInFlowResult> => {
  const selector = await findSignInSelectorByDomain(params.db, params.domain);
  if (!selector) {
    return { success: false, errorMessage: 'Sign-in selector not found' };
  }

  const existingStateJson = await params.kv.get(buildStorageStateKey(params.domain, params.userId));
  const existingState = existingStateJson ? deserializeStorageState(existingStateJson) : undefined;

  const signInResult = await performSignIn({
    browserWorker: params.browserWorker,
    signInUrl: selector.signInUrl,
    userIdSelector: selector.userIdSelector,
    passwordSelector: selector.passwordSelector,
    signInButtonSelector: selector.signInButtonSelector,
    userId: params.userId,
    password: params.password,
    storageState: existingState,
  });

  if (!signInResult.success) {
    return {
      success: false,
      errorMessage: signInResult.errorMessage ?? 'Sign-in failed',
    };
  }

  const storageStateKey = buildStorageStateKey(params.domain, params.userId);
  await params.kv.put(storageStateKey, serializeStorageState(signInResult.storageState));

  return { success: true };
};

interface FetchPageContext {
  params: FetchWithSignInParams;
  domain: string;
  storageStateKey: string;
}

interface FetchInitialPageResult {
  html: string;
  storageState: ReturnType<typeof deserializeStorageState>;
  error?: false;
}

interface FetchInitialPageError {
  error: true;
  errorMessage: string;
}

const fetchInitialPage = async (
  ctx: FetchPageContext,
): Promise<FetchInitialPageResult | FetchInitialPageError> => {
  const existingStateJson = await ctx.params.kv.get(ctx.storageStateKey);
  const existingState = existingStateJson ? deserializeStorageState(existingStateJson) : undefined;

  const result = await fetchPage({
    browserWorker: ctx.params.browserWorker,
    url: ctx.params.url,
    storageState: existingState,
  });

  if ('error' in result) {
    return { error: true, errorMessage: result.errorMessage };
  }

  return result;
};

const refetchAfterSignIn = async (ctx: FetchPageContext): Promise<FetchWithSignInResult> => {
  const newStateJson = await ctx.params.kv.get(ctx.storageStateKey);
  const newState = newStateJson ? deserializeStorageState(newStateJson) : undefined;

  const retriedPageResult = await fetchPage({
    browserWorker: ctx.params.browserWorker,
    url: ctx.params.url,
    storageState: newState,
  });

  if ('error' in retriedPageResult) {
    return { html: '', signedIn: false, errorMessage: retriedPageResult.errorMessage };
  }

  await ctx.params.kv.put(
    ctx.storageStateKey,
    serializeStorageState(retriedPageResult.storageState),
  );
  return { html: retriedPageResult.html, signedIn: true };
};

export const fetchPageWithSignIn = async (
  params: FetchWithSignInParams,
): Promise<FetchWithSignInResult> => {
  const url = new URL(params.url);
  const domain = url.hostname;
  const storageStateKey = buildStorageStateKey(domain, params.userId);
  const ctx: FetchPageContext = { params, domain, storageStateKey };

  const pageResult = await fetchInitialPage(ctx);

  if (pageResult.error) {
    return { html: '', signedIn: false, errorMessage: pageResult.errorMessage };
  }

  const validation = await findSignedInValidationByDomain(params.db, domain);
  if (!validation) {
    await params.kv.put(storageStateKey, serializeStorageState(pageResult.storageState));
    return { html: pageResult.html, signedIn: false };
  }

  const validationBrowser: Browser = await launchBrowser(params.browserWorker);
  const context = await validationBrowser.newContext({ storageState: pageResult.storageState });
  const validationResult = await checkSignedIn({
    context,
    url: params.url,
    textSelector: validation.textSelector,
    isSignedInRegexPattern: validation.isSignedInRegexPattern,
  });
  await context.close();
  await validationBrowser.close();

  if (validationResult.isSignedIn) {
    await params.kv.put(storageStateKey, serializeStorageState(pageResult.storageState));
    return { html: pageResult.html, signedIn: true };
  }

  const signInResult = await executeSignInFlow({
    browserWorker: params.browserWorker,
    db: params.db,
    kv: params.kv,
    domain,
    userId: params.userId,
    password: params.password,
  });

  if (!signInResult.success) {
    return { html: pageResult.html, signedIn: false, errorMessage: signInResult.errorMessage };
  }

  return refetchAfterSignIn(ctx);
};

export const buildStorageStateKeyForTest = (domain: string, userId: string): string =>
  buildStorageStateKey(domain, userId);
