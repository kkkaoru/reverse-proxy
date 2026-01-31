// IP rotation fetch operations
// Execute with bun: wrangler dev

import { isIpRotateTarget } from '../../ip-rotate/client.ts';
import { fetchWithRetry } from '../../ip-rotate/fetch.ts';
import type { FetchRetryResult } from '../../ip-rotate/types.ts';
import { logEvent } from '../cache.ts';
import { LOG_EVENT_IP_ROTATE, METHOD_GET } from '../constants.ts';
import type { IpRotateFetchParams, IpRotateFetchResult, ProxyCacheOptions } from '../types.ts';

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

  if (!result.success) {
    return result.lastResponse ? { response: result.lastResponse, usedEndpoint: '' } : null;
  }

  return { response: result.response, usedEndpoint: result.usedEndpoint };
};

// Check if should use IP rotation for the given URL
export const shouldUseIpRotate = (options: ProxyCacheOptions, url: URL): boolean => {
  if (!options.ipRotateConfig) {
    return false;
  }
  return isIpRotateTarget(options.ipRotateConfig, url.host);
};

// Perform fetch with IP rotation
export const performIpRotateFetch = async (
  options: ProxyCacheOptions,
  url: URL,
  headers: Record<string, string>,
): Promise<Response | null> => {
  if (!options.ipRotateConfig) {
    return null;
  }

  const ipRotateResult: IpRotateFetchResult | null = await fetchViaIpRotate({
    url,
    headers,
    config: options.ipRotateConfig,
    counters: options.ipRotateCounters,
  });

  if (!ipRotateResult) {
    return null;
  }

  logEvent(options, LOG_EVENT_IP_ROTATE, {
    target: url.toString(),
    ipRotateUrl: url.host,
    ipRotateEndpoint: ipRotateResult.usedEndpoint,
  });

  return ipRotateResult.response;
};
