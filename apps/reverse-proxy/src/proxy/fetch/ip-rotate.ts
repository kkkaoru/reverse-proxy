// IP rotation fetch operations
// Execute with bun: wrangler dev

import { isIpRotateTarget } from '../../ip-rotate/client.ts';
import { fetchWithRetry } from '../../ip-rotate/fetch.ts';
import { reportOutcomeToDO } from '../../ip-rotate/health-sync.ts';
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

// Report outcome to Durable Object via waitUntil
const reportOutcomeAsync = (params: PerformIpRotateFetchParams, result: FetchRetryResult): void => {
  if (!(params.options.healthCoordinator && params.options.executionCtx)) return;

  const isSuccess: boolean = result.success;
  const status: number | undefined = result.success
    ? result.response.status
    : result.lastResponse?.status;
  const isThrottle: boolean = status === 429;
  const isServerError: boolean = (status ?? 0) >= 500;

  params.options.executionCtx.waitUntil(
    reportOutcomeToDO({
      healthCoordinator: params.options.healthCoordinator,
      domain: params.url.host,
      index: 0,
      isSuccess,
      isThrottle,
      isServerError,
    }),
  );
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
    wallClockSignal: ipRotateParams.wallClockSignal,
    ...ipRotateParams.tuningEnv,
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

  const fetchResult: FetchRetryResult = await fetchWithRetry({
    config: params.options.ipRotateConfig,
    targetUrl: params.url,
    counters: params.options.ipRotateCounters,
    headers: params.headers,
    method: METHOD_GET,
    wallClockSignal: params.wallClockSignal,
    ...params.options.ipRotateTuningEnv,
  });

  // Report outcome to Durable Object asynchronously
  reportOutcomeAsync(params, fetchResult);

  if (!fetchResult.success) {
    return fetchResult.lastResponse ?? null;
  }

  logEvent(params.options, LOG_EVENT_IP_ROTATE, {
    target: params.url.toString(),
    ipRotateUrl: params.url.host,
    ipRotateEndpoint: fetchResult.usedEndpoint,
  });

  return fetchResult.response;
};
