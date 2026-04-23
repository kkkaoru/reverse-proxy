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

// Perform fetch with IP rotation support. If the primary path returns an
// Akamai block (403 or 200 with Access Denied HTML body) OR a transient
// upstream failure (5xx including 660, 429, 408), retry via IP rotate
// endpoints which present different egress IPs per region.
export const performFetch = async (params: PerformFetchParams): Promise<Response> => {
  const url: URL = new URL(params.currentUrl);

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
