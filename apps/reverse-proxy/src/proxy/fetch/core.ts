// Core fetch operations
// Execute with bun: wrangler dev

import {
  CACHE_MODE_NO_STORE,
  MAX_REDIRECTS,
  REDIRECT_MANUAL,
  WALL_CLOCK_TIMEOUT_MS,
} from '../constants.ts';
import type { FetchAndCacheParams, ProxyCacheOptions } from '../types.ts';
import { buildFetchHeaders } from './headers.ts';
import { performIpRotateFetch, shouldUseIpRotate } from './ip-rotate.ts';
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

// Perform fetch with IP rotation support
export const performFetch = async (params: PerformFetchParams): Promise<Response> => {
  const url: URL = new URL(params.currentUrl);

  if (!shouldUseIpRotate(params.options, url)) {
    return performStandardFetch(params.currentUrl, params.headers, params.wallClockSignal);
  }

  const ipRotateResponse: Response | null = await performIpRotateFetch({
    options: params.options,
    url,
    headers: params.headers,
    wallClockSignal: params.wallClockSignal,
  });
  return (
    ipRotateResponse ??
    performStandardFetch(params.currentUrl, params.headers, params.wallClockSignal)
  );
};

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
