// Proxy fetch operations
// Execute with bun: wrangler dev

import { isIpRotateTarget } from '../ip-rotate/client.ts';
import { fetchWithRetry } from '../ip-rotate/fetch.ts';
import type { FetchRetryResult } from '../ip-rotate/types.ts';
import { cacheResponse, logEvent, storeInKvCache } from './cache.ts';
import {
  CACHE_MODE_NO_STORE,
  CONNECTION_KEEP_ALIVE,
  DEFAULT_ACCEPT,
  DEFAULT_ACCEPT_ENCODING,
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_USER_AGENT,
  ERROR_BODY_SLICE_LENGTH,
  ERROR_TOO_MANY_REDIRECTS,
  HEADER_ACCEPT,
  HEADER_ACCEPT_ENCODING,
  HEADER_ACCEPT_LANGUAGE,
  HEADER_CONNECTION,
  HEADER_LOCATION,
  HEADER_REFERER,
  HEADER_SEC_FETCH_DEST,
  HEADER_SEC_FETCH_MODE,
  HEADER_SEC_FETCH_SITE,
  HEADER_SEC_FETCH_USER,
  HEADER_UPGRADE_INSECURE_REQUESTS,
  HEADER_USER_AGENT,
  LOG_EVENT_IP_ROTATE,
  LOG_EVENT_UPSTREAM_ERROR,
  MAX_REDIRECTS,
  METHOD_GET,
  REDIRECT_MANUAL,
  SEC_FETCH_DEST_DOCUMENT,
  SEC_FETCH_MODE_NAVIGATE,
  SEC_FETCH_SITE_NONE,
  SEC_FETCH_USER_TRUE,
  STATUS_BAD_GATEWAY,
  STATUS_CLIENT_ERROR_START,
  STATUS_REDIRECT_END,
  STATUS_REDIRECT_START,
  UPGRADE_INSECURE_TRUE,
} from './constants.ts';
import { createErrorResponse } from './responses.ts';
import type {
  FetchAndCacheParams,
  IpRotateFetchParams,
  IpRotateFetchResult,
  LogUpstreamErrorParams,
  ProcessFetchResponseParams,
  ProxyCacheOptions,
} from './types.ts';

// Status checks
export const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

export const isRedirectStatus = (status: number): boolean =>
  status >= STATUS_REDIRECT_START && status < STATUS_REDIRECT_END;

// Build fetch headers
export const buildFetchHeaders = (targetOrigin: string): Record<string, string> => ({
  [HEADER_USER_AGENT]: DEFAULT_USER_AGENT,
  [HEADER_ACCEPT]: DEFAULT_ACCEPT,
  [HEADER_ACCEPT_LANGUAGE]: DEFAULT_ACCEPT_LANGUAGE,
  [HEADER_ACCEPT_ENCODING]: DEFAULT_ACCEPT_ENCODING,
  [HEADER_REFERER]: targetOrigin,
  [HEADER_CONNECTION]: CONNECTION_KEEP_ALIVE,
  [HEADER_UPGRADE_INSECURE_REQUESTS]: UPGRADE_INSECURE_TRUE,
  [HEADER_SEC_FETCH_DEST]: SEC_FETCH_DEST_DOCUMENT,
  [HEADER_SEC_FETCH_MODE]: SEC_FETCH_MODE_NAVIGATE,
  [HEADER_SEC_FETCH_SITE]: SEC_FETCH_SITE_NONE,
  [HEADER_SEC_FETCH_USER]: SEC_FETCH_USER_TRUE,
});

// Log upstream error
export const logUpstreamError = async (params: LogUpstreamErrorParams): Promise<void> => {
  const errorBody: string = await params.response.clone().text();
  logEvent(params.options, LOG_EVENT_UPSTREAM_ERROR, {
    target: params.target.toString(),
    finalUrl: params.currentUrl,
    status: params.response.status,
    body: errorBody.slice(0, ERROR_BODY_SLICE_LENGTH),
  });
};

// Handle redirect
export const handleRedirect = (response: Response, currentUrl: string): string | null => {
  const location: string | null = response.headers.get(HEADER_LOCATION);
  return location ? new URL(location, currentUrl).toString() : null;
};

// Create too many redirects response
export const createTooManyRedirectsResponse = (
  options: ProxyCacheOptions,
  target: URL,
): Response => {
  logEvent(options, LOG_EVENT_UPSTREAM_ERROR, {
    target: target.toString(),
    error: ERROR_TOO_MANY_REDIRECTS,
  });
  return createErrorResponse(ERROR_TOO_MANY_REDIRECTS, STATUS_BAD_GATEWAY);
};

// Process fetch response
export const processFetchResponse = async (
  processParams: ProcessFetchResponseParams,
): Promise<Response> => {
  const { params, response, currentUrl } = processParams;

  if (!isCacheableStatus(response.status)) {
    await logUpstreamError({
      options: params.options,
      target: params.target,
      currentUrl,
      response,
    });
    return response;
  }

  if (params.options.enableCacheApi) {
    await cacheResponse(params.cacheKey, response);
  }
  await storeInKvCache(params, response);
  return response;
};

// Fetch via IP rotation with retry
export const fetchViaIpRotate = async (
  ipRotateParams: IpRotateFetchParams,
): Promise<IpRotateFetchResult | null> => {
  const result: FetchRetryResult = await fetchWithRetry({
    config: ipRotateParams.config,
    targetUrl: ipRotateParams.url,
    counters: ipRotateParams.counters,
    headers: ipRotateParams.headers,
    method: METHOD_GET,
  });

  if (result.success) {
    return { response: result.response, usedEndpoint: result.usedEndpoint };
  }

  return result.lastResponse ? { response: result.lastResponse, usedEndpoint: '' } : null;
};

// Check if should use IP rotation
export const shouldUseIpRotate = (options: ProxyCacheOptions, url: URL): boolean => {
  if (!options.ipRotateConfig) {
    return false;
  }
  return isIpRotateTarget(options.ipRotateConfig, url.host);
};

// Perform fetch with IP rotation support
export const performFetch = async (
  options: ProxyCacheOptions,
  currentUrl: string,
  headers: Record<string, string>,
): Promise<Response> => {
  const url: URL = new URL(currentUrl);

  if (shouldUseIpRotate(options, url) && options.ipRotateConfig) {
    const ipRotateResult: IpRotateFetchResult | null = await fetchViaIpRotate({
      url,
      headers,
      config: options.ipRotateConfig,
      counters: options.ipRotateCounters,
    });

    if (ipRotateResult) {
      logEvent(options, LOG_EVENT_IP_ROTATE, {
        target: currentUrl,
        ipRotateUrl: url.host,
        ipRotateEndpoint: ipRotateResult.usedEndpoint,
      });
      return ipRotateResult.response;
    }
  }

  return globalThis.fetch(currentUrl, {
    cache: CACHE_MODE_NO_STORE,
    headers,
    redirect: REDIRECT_MANUAL,
  });
};

// Fetch and cache with redirect handling
export const fetchAndCache = async (params: FetchAndCacheParams): Promise<Response> => {
  const headers: Record<string, string> = buildFetchHeaders(params.target.origin);
  let currentUrl: string = params.target.toString();
  let redirectCount: number = 0;

  while (redirectCount < MAX_REDIRECTS) {
    // biome-ignore lint/performance/noAwaitInLoops: Sequential redirects require await in loop
    const response: Response = await performFetch(params.options, currentUrl, headers);

    if (!isRedirectStatus(response.status)) {
      return processFetchResponse({ params, response, currentUrl });
    }

    const redirectUrl: string | null = handleRedirect(response, currentUrl);
    if (!redirectUrl) {
      return processFetchResponse({ params, response, currentUrl });
    }

    currentUrl = redirectUrl;
    redirectCount++;
  }

  return createTooManyRedirectsResponse(params.options, params.target);
};
