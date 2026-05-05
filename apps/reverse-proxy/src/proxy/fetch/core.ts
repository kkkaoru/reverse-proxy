// Core fetch operations
// Execute with bun: wrangler dev

import type { FailureCategory } from '../classifier/categories.ts';
import { routeForCategory } from '../classifier/categories.ts';
import { classifyResponse } from '../classifier/response-classifier.ts';
import {
  CACHE_MODE_NO_STORE,
  MAX_REDIRECTS,
  REDIRECT_MANUAL,
  WALL_CLOCK_TIMEOUT_MS,
} from '../constants.ts';
import type { FetchAndCacheParams, ProxyCacheOptions } from '../types.ts';
import { buildFetchHeaders } from './headers.ts';
import { performIpRotateFetch } from './ip-rotate.ts';
import { createTooManyRedirectsResponse, handleRedirect } from './redirect.ts';
import { processFetchResponse } from './response.ts';
import { isRedirectStatus } from './status.ts';

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

// Decide whether a response should trigger the IP rotate / browser
// fallback path. Returns the abstract FailureCategory (or null when
// the response is acceptable). Domain-specific signals (Akamai HTML
// markers, mojibake, empty bodies, transient 5xx codes) are mapped to
// categories inside response-classifier so the caller does not need
// to know which one matched.
const classifyFallbackReason = async (response: Response): Promise<FailureCategory> =>
  classifyResponse({ response });

// Backwards-compat label helper for the structured logs that older
// observability dashboards still grep for.
const failureReasonLabel = (category: FailureCategory): string => category ?? 'none';

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

// Hedged fetch: race IP-rotate vs standard fetch in parallel and take
// the first acceptable response. The non-winning request is left to
// settle in the background (its body is cancelled by the caller's
// wall-clock signal). Eliminates the simple→IP-rotate sequential wait
// when one path is intermittently slow (a recurring pattern observed
// for NAR / obihiro race pages where simple-path latency varies from
// 5s to >25s for the same URL).
//
// Returns:
//   - winning Response when at least one path produced an acceptable
//     answer (FailureCategory === null per classifyFallbackReason);
//   - null when both paths failed / returned an unrecoverable category
//     so the caller can decide whether to retry.
const HEDGED_RACE_LOG_LIMIT: number = 1 satisfies number;
const HEDGED_RACE_LOG_DUMMY_INDEX: number = 0 satisfies number;

const racingFetch = async (params: PerformFetchParams, url: URL): Promise<Response | null> => {
  const candidates: Promise<Response | null>[] = [
    performStandardFetch(params.currentUrl, params.headers, params.wallClockSignal).catch(
      () => null,
    ),
  ];
  if (params.options.ipRotateConfig) {
    candidates.push(
      performIpRotateFetch({
        options: params.options,
        url,
        headers: params.headers,
        wallClockSignal: params.wallClockSignal,
      }).catch(() => null),
    );
  }

  // Promise.allSettled then filter retains the ability to fall back
  // to whichever finished if neither is "acceptable" per the routing
  // strategy. Promise.race alone would surface the FIRST settled
  // promise even if it failed.
  const settled: PromiseSettledResult<Response | null>[] = await Promise.allSettled(candidates);
  const fulfilled: Response[] = settled
    .filter(
      (r: PromiseSettledResult<Response | null>): r is PromiseFulfilledResult<Response> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r: PromiseFulfilledResult<Response>) => r.value);

  // Classify all candidates in parallel and pick the first acceptable
  // one (FailureCategory === null). If none are acceptable, return the
  // first concrete Response so the caller can inspect status and fall
  // back to the browser path.
  const reasons: FailureCategory[] = await Promise.all(
    fulfilled.map((r: Response) => classifyFallbackReason(r)),
  );
  const acceptableIndex: number = reasons.findIndex((r: FailureCategory) => r === null);
  const fallbackIndex: number = HEDGED_RACE_LOG_DUMMY_INDEX;
  if (acceptableIndex >= HEDGED_RACE_LOG_DUMMY_INDEX) {
    return fulfilled[acceptableIndex] ?? null;
  }
  return fulfilled.length >= HEDGED_RACE_LOG_LIMIT ? (fulfilled[fallbackIndex] ?? null) : null;
};

// Execute one end-to-end attempt: hedged primary+secondary path.
const performFetchSingleAttempt = async (
  params: PerformFetchParams,
  url: URL,
): Promise<Response> => {
  const hedged: Response | null = await racingFetch(params, url);
  if (hedged !== null) return hedged;
  // Both paths threw — last-resort: try standard fetch one more time
  // so the caller gets a real Response object (even if it's an error
  // status) to inspect rather than a thrown exception.
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

// Categories that the routing strategy says should not be retried at
// the proxy layer. `null` (success) and `client-error` ('fail' route)
// both terminate the attempt loop immediately so we don't waste retry
// budget on a permanent 4xx like 404.
const isTerminalCategory = (reason: FailureCategory): boolean =>
  reason === null || routeForCategory(reason) === 'fail';

// Single pass of the retry loop: run the attempt, decide retry or terminate.
const performFetchOneIteration = async (
  ctx: AttemptLoopContext,
  attempt: number,
): Promise<{ readonly terminal: boolean; readonly response: Response }> => {
  const response: Response = await performFetchSingleAttempt(ctx.params, ctx.url);
  const reason: FailureCategory = await classifyFallbackReason(response);
  if (isTerminalCategory(reason) || attempt === PROXY_RETRY_MAX_ATTEMPTS - 1) {
    return { terminal: true, response };
  }
  logProxyRetry({
    attempt,
    reason: failureReasonLabel(reason),
    response,
    url: ctx.url,
  });
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
