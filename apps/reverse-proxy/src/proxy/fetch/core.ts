// Core fetch operations
// Execute with bun: wrangler dev

import {
  CACHE_MODE_NO_STORE,
  MAX_REDIRECTS,
  REDIRECT_MANUAL,
  WALL_CLOCK_TIMEOUT_MS,
} from '../constants.ts';
import type { FetchAndCacheParams, ProxyCacheOptions } from '../types.ts';
import { isAkamaiBlockedResponse } from './akamai.ts';
import { buildFetchHeaders } from './headers.ts';
import { performIpRotateFetch, shouldUseIpRotate } from './ip-rotate.ts';
import { createTooManyRedirectsResponse, handleRedirect } from './redirect.ts';
import { processFetchResponse } from './response.ts';
import { isRedirectStatus, isTransientUpstreamFailureStatus } from './status.ts';

// Recursive fetch state interface
interface FetchState {
  readonly currentUrl: string;
  readonly redirectCount: number;
  readonly wallClockSignal?: AbortSignal;
}

interface PerformFetchParams {
  readonly options: ProxyCacheOptions;
  readonly currentUrl: string;
  readonly headers: Record<string, string>;
  readonly wallClockSignal?: AbortSignal;
}

// Perform standard fetch without IP rotation
export const performStandardFetch = (
  currentUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> =>
  globalThis.fetch(currentUrl, {
    cache: CACHE_MODE_NO_STORE,
    headers,
    redirect: REDIRECT_MANUAL,
    signal,
  });

// Decide whether a response should trigger the IP rotate fallback path.
// Returns a label describing the failure reason, or null if the response is
// considered acceptable and should be returned to the caller.
const classifyFallbackReason = async (
  response: Response,
): Promise<'akamai-block' | 'transient-upstream-failure' | null> => {
  if (await isAkamaiBlockedResponse(response)) return 'akamai-block';
  if (isTransientUpstreamFailureStatus(response.status)) {
    return 'transient-upstream-failure';
  }
  return null;
};

// Try falling back to IP rotate (AWS API Gateway regional egress). Returns
// null if fallback is not configured or itself returned an unrecoverable
// response (Akamai block or transient upstream failure).
const tryIpRotateFallback = async (
  params: PerformFetchParams,
  url: URL,
): Promise<Response | null> => {
  if (!params.options.ipRotateConfig) return null;
  const ipRotateResponse: Response | null = await performIpRotateFetch({
    options: params.options,
    url,
    headers: params.headers,
    wallClockSignal: params.wallClockSignal,
  });
  if (!ipRotateResponse) return null;
  if ((await classifyFallbackReason(ipRotateResponse)) !== null) return null;
  // biome-ignore lint/suspicious/noConsole: observability for fallback behavior
  console.log('[proxy]', {
    event: 'ip-rotate-recovered',
    target: url.toString(),
    status: ipRotateResponse.status,
  });
  return ipRotateResponse;
};

// Proxy-layer retry (in addition to the per-endpoint retry loop inside
// fetchWithRetry). The IP rotate path already retries up to 5+ endpoints with
// hedge, so this outer loop only adds ONE extra full attempt. Keeping the
// budget tight prevents a retry storm (proxy 3x * IP-rotate 5x * client 10x
// = 150 upstream fetches per logical request) which was correlated with a
// rise in 400 and 6xx errors from rate-limited / overloaded upstream.
const PROXY_RETRY_MAX_ATTEMPTS: number = 2;
const PROXY_RETRY_BASE_DELAY_MS: number = 300;
const PROXY_RETRY_BACKOFF_FACTOR: number = 2;

const proxyRetryDelayMs = (attempt: number): number =>
  PROXY_RETRY_BASE_DELAY_MS * PROXY_RETRY_BACKOFF_FACTOR ** attempt;

const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Execute one end-to-end attempt: primary path + single cross-path fallback.
const performFetchSingleAttempt = async (
  params: PerformFetchParams,
  url: URL,
): Promise<Response> => {
  if (!shouldUseIpRotate(params.options, url)) {
    const standardResponse: Response = await performStandardFetch(
      params.currentUrl,
      params.headers,
      params.wallClockSignal,
    );
    const reason: 'akamai-block' | 'transient-upstream-failure' | null =
      await classifyFallbackReason(standardResponse);
    if (reason === null) return standardResponse;
    // biome-ignore lint/suspicious/noConsole: observability for fallback trigger
    console.log('[proxy]', {
      event: 'standard-fetch-fallback',
      reason,
      target: url.toString(),
      status: standardResponse.status,
    });
    const recovered: Response | null = await tryIpRotateFallback(params, url);
    return recovered ?? standardResponse;
  }

  const ipRotateResponse: Response | null = await performIpRotateFetch({
    options: params.options,
    url,
    headers: params.headers,
    wallClockSignal: params.wallClockSignal,
  });
  if (ipRotateResponse !== null && (await classifyFallbackReason(ipRotateResponse)) === null) {
    return ipRotateResponse;
  }
  // IP rotate failed or returned block/transient failure - last resort: standard fetch
  return performStandardFetch(params.currentUrl, params.headers, params.wallClockSignal);
};

interface ProxyRetryLogParams {
  readonly attempt: number;
  readonly reason: string;
  readonly response: Response;
  readonly url: URL;
}

// Emit the proxy-retry log entry and cancel the about-to-be-discarded body
// stream so CF Worker memory does not accumulate across retries.
const logProxyRetry = (params: ProxyRetryLogParams): void => {
  // biome-ignore lint/suspicious/noConsole: observability for proxy-level retry
  console.log('[proxy]', {
    event: 'proxy-retry',
    attempt: params.attempt,
    reason: params.reason,
    status: params.response.status,
    target: params.url.toString(),
  });
  params.response.body?.cancel().catch(() => {});
};

interface AttemptLoopContext {
  readonly params: PerformFetchParams;
  readonly url: URL;
}

// Single pass of the retry loop: run the attempt, decide retry or terminate.
const performFetchOneIteration = async (
  ctx: AttemptLoopContext,
  attempt: number,
): Promise<{ readonly terminal: boolean; readonly response: Response }> => {
  const response: Response = await performFetchSingleAttempt(ctx.params, ctx.url);
  const reason: 'akamai-block' | 'transient-upstream-failure' | null =
    await classifyFallbackReason(response);
  if (reason === null || attempt === PROXY_RETRY_MAX_ATTEMPTS - 1) {
    return { terminal: true, response };
  }
  logProxyRetry({ attempt, reason, response, url: ctx.url });
  return { terminal: false, response };
};

// Recursive attempt loop with bounded retries and backoff. Honours the
// wall-clock signal so CF Worker wall-clock budget is not exceeded.
const runAttemptLoop = async (
  ctx: AttemptLoopContext,
  attempt: number,
  lastResponse: Response | null,
): Promise<Response> => {
  if (attempt >= PROXY_RETRY_MAX_ATTEMPTS) {
    return lastResponse ?? performFetchSingleAttempt(ctx.params, ctx.url);
  }
  if (ctx.params.wallClockSignal?.aborted && lastResponse) {
    return lastResponse;
  }
  const step = await performFetchOneIteration(ctx, attempt);
  if (step.terminal) return step.response;
  await waitMs(proxyRetryDelayMs(attempt));
  return runAttemptLoop(ctx, attempt + 1, step.response);
};

// Perform fetch with proxy-layer retry + IP rotation. Each attempt runs the
// full primary+fallback flow; if the final response is still a transient
// failure or Akamai block, we wait briefly (bounded backoff) and try again.
// CF Worker subrequest + wall-clock budgets are respected by capping
// PROXY_RETRY_MAX_ATTEMPTS and keeping the wall-clock signal intact.
export const performFetch = (params: PerformFetchParams): Promise<Response> =>
  runAttemptLoop({ params, url: new URL(params.currentUrl) }, 0, null);

// Process single fetch iteration - returns response or next state for recursion
const processFetchIteration = async (
  params: FetchAndCacheParams,
  headers: Record<string, string>,
  state: FetchState,
): Promise<Response | FetchState> => {
  const response: Response = await performFetch({
    options: params.options,
    currentUrl: state.currentUrl,
    headers,
    wallClockSignal: state.wallClockSignal,
  });

  if (!isRedirectStatus(response.status)) {
    return processFetchResponse({ params, response, currentUrl: state.currentUrl });
  }

  const redirectUrl: string | null = handleRedirect(response, state.currentUrl);
  if (!redirectUrl) {
    return processFetchResponse({ params, response, currentUrl: state.currentUrl });
  }

  return {
    currentUrl: redirectUrl,
    redirectCount: state.redirectCount + 1,
    wallClockSignal: state.wallClockSignal,
  };
};

// Recursive fetch with redirect handling
const fetchWithRedirects = async (
  params: FetchAndCacheParams,
  headers: Record<string, string>,
  state: FetchState,
): Promise<Response> => {
  if (state.redirectCount >= MAX_REDIRECTS) {
    return createTooManyRedirectsResponse(params.options, params.target);
  }

  const result: Response | FetchState = await processFetchIteration(params, headers, state);

  if (result instanceof Response) {
    return result;
  }

  return fetchWithRedirects(params, headers, result);
};

// Fetch and cache with redirect handling - entry point
export const fetchAndCache = (params: FetchAndCacheParams): Promise<Response> => {
  const headers: Record<string, string> = buildFetchHeaders(params.target.origin);
  const wallClockSignal: AbortSignal = AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS);
  const initialState: FetchState = {
    currentUrl: params.target.toString(),
    redirectCount: 0,
    wallClockSignal,
  };
  return fetchWithRedirects(params, headers, initialState);
};
