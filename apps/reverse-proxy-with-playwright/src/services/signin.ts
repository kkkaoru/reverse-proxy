// Sign-in flow orchestration service
// Execute with bun: wrangler dev

import type { BrowserWorker } from '@cloudflare/playwright';
import type { D1Database } from '@cloudflare/workers-types';
import { findSignInSelectorByDomain } from '../repositories/sign-in-selectors.ts';
import { isAccessGateHtml } from '../utils/page-access.ts';
import { buildStorageStateKey } from '../utils/storage-state.ts';
import {
  deserializeStorageState,
  fetchPage,
  performSignIn,
  serializeStorageState,
} from './browser.ts';

interface SignInFlowParams {
  browserWorker: BrowserWorker;
  db: D1Database;
  kv: KVNamespace;
  domain: string;
  userId: string;
  password: string;
  forceFreshSession?: boolean;
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
  refreshedSession?: boolean;
}

export const executeSignInFlow = async (params: SignInFlowParams): Promise<SignInFlowResult> => {
  const selector = await findSignInSelectorByDomain(params.db, params.domain);
  if (!selector) {
    return { success: false, errorMessage: 'Sign-in selector not found' };
  }

  const storageStateKey = buildStorageStateKey(params.domain, params.userId);
  const existingStateJson = params.forceFreshSession ? null : await params.kv.get(storageStateKey);
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

const refetchAfterSignIn = async (
  ctx: FetchPageContext,
  refreshedSession: boolean,
): Promise<FetchWithSignInResult> => {
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
  return {
    html: retriedPageResult.html,
    signedIn: !isAccessGateHtml(retriedPageResult.html),
    refreshedSession,
  };
};

const signInAndRefetch = async (
  ctx: FetchPageContext,
  forceFreshSession: boolean,
): Promise<FetchWithSignInResult> => {
  if (forceFreshSession) {
    await ctx.params.kv.delete(ctx.storageStateKey);
  }

  const signInResult = await executeSignInFlow({
    browserWorker: ctx.params.browserWorker,
    db: ctx.params.db,
    kv: ctx.params.kv,
    domain: ctx.domain,
    userId: ctx.params.userId,
    password: ctx.params.password,
    forceFreshSession,
  });

  if (!signInResult.success) {
    return { html: '', signedIn: false, errorMessage: signInResult.errorMessage };
  }

  return refetchAfterSignIn(ctx, true);
};

const isSignedInFetchResult = (result: FetchWithSignInResult): boolean =>
  !result.errorMessage && result.signedIn;

const refreshSessionAndFetch = async (ctx: FetchPageContext): Promise<FetchWithSignInResult> => {
  const retriedResult = await signInAndRefetch(ctx, false);
  return isSignedInFetchResult(retriedResult) ? retriedResult : signInAndRefetch(ctx, true);
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

  if (isAccessGateHtml(pageResult.html)) {
    return refreshSessionAndFetch(ctx);
  }

  // Treat the initial fetch as authoritative for sign-in state. The previous
  // implementation ran a second checkSignedIn pass in a separate browser
  // context, which caused two problems under load:
  //   1. Concurrent requests for the same (domain, userId) each spawned a
  //      validation browser that occasionally returned signed-out (Cloudflare
  //      Browser Rendering allocates fresh contexts/egress per session and
  //      netkeiba sometimes refused the cookie set), triggering needless
  //      `refreshSessionAndFetch` calls that overwrote the KV storage state
  //      with a newer sign-in. Three parallel requests racing through this
  //      path produced "auth_required" responses for whichever request lost
  //      the race.
  //   2. Each validation call doubled the per-request Playwright budget.
  // The hardened `isAccessGateHtml` already requires a positive marker
  // (`Icon_Account`, `Comment_Table_Show_All`) on netkeiba pages, so the
  // additional regex/selector pass adds no signal we trust more.
  await params.kv.put(storageStateKey, serializeStorageState(pageResult.storageState));
  return { html: pageResult.html, signedIn: true };
};
