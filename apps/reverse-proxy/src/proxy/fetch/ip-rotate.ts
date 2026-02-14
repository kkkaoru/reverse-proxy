// IP rotation fetch operations
// Execute with bun: wrangler dev

import { isIpRotateTarget } from '../../ip-rotate/client.ts';
import { fetchWithRetry } from '../../ip-rotate/fetch.ts';
import type { FetchRetryResult } from '../../ip-rotate/types.ts';
import { logEvent } from '../cache.ts';
import { LOG_EVENT_IP_ROTATE, METHOD_GET } from '../constants.ts';
import type { IpRotateFetchParams, IpRotateFetchResult, ProxyCacheOptions } from '../types.ts';

interface PerformIpRotateFetchParams {
  readonly options: ProxyCacheOptions;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly wallClockSignal?: AbortSignal;
}

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
    envDefaultTimeoutMs: ipRotateParams.envDefaultTimeoutMs,
    wallClockSignal: ipRotateParams.wallClockSignal,
  });

  if (!result.success) {
    return result.lastResponse
      ? { response: result.lastResponse, usedEndpoint: result.lastUsedEndpoint ?? '' }
      : null;
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
  params: PerformIpRotateFetchParams,
): Promise<Response | null> => {
  if (!params.options.ipRotateConfig) {
    return null;
  }

  const ipRotateResult: IpRotateFetchResult | null = await fetchViaIpRotate({
    url: params.url,
    headers: params.headers,
    config: params.options.ipRotateConfig,
    counters: params.options.ipRotateCounters,
    envDefaultTimeoutMs: params.options.defaultTimeoutMs,
    wallClockSignal: params.wallClockSignal,
  });

  if (!ipRotateResult) {
    return null;
  }

  logEvent(params.options, LOG_EVENT_IP_ROTATE, {
    target: params.url.toString(),
    ipRotateUrl: params.url.host,
    ipRotateEndpoint: ipRotateResult.usedEndpoint,
  });

  return ipRotateResult.response;
};
