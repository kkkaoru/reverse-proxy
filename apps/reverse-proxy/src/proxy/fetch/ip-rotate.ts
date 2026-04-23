// IP rotation fetch operations
// Execute with bun: wrangler dev

import { isIpRotateTarget } from '../../ip-rotate/client.ts';
import { fetchWithRetry } from '../../ip-rotate/fetch.ts';
import { reportOutcomeToDO } from '../../ip-rotate/health-sync.ts';
import type { EndpointOutcome, FetchRetryResult } from '../../ip-rotate/types.ts';
import { logEvent } from '../cache.ts';
import { LOG_EVENT_IP_ROTATE, METHOD_GET } from '../constants.ts';
import type { IpRotateFetchParams, IpRotateFetchResult, ProxyCacheOptions } from '../types.ts';

interface PerformIpRotateFetchParams {
  readonly options: ProxyCacheOptions;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly wallClockSignal?: AbortSignal;
}

// Build an onEndpointOutcome callback that forwards each attempt's result to
// the Durable Object via waitUntil. Uses the ACTUAL endpoint index (not a
// hardcoded 0), so per-endpoint failures on 5xx/6xx/429 are remembered across
// Worker instances. The DO stores a timestamp and the read side enforces a
// 60-second TTL, so endpoints are only temporarily deprioritized, never
// permanently excluded.
const buildOutcomeReporter = (
  params: PerformIpRotateFetchParams,
): ((outcome: EndpointOutcome) => void) | undefined => {
  const coordinator: DurableObjectNamespace | undefined = params.options.healthCoordinator;
  const executionCtx: ExecutionContext | undefined = params.options.executionCtx;
  if (!(coordinator && executionCtx)) return undefined;
  const domain: string = params.url.host;
  return (outcome: EndpointOutcome): void => {
    executionCtx.waitUntil(
      reportOutcomeToDO({
        healthCoordinator: coordinator,
        domain,
        index: outcome.index,
        isSuccess: outcome.isSuccess,
        isThrottle: outcome.isThrottle,
        isServerError: outcome.isServerError,
      }),
    );
  };
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
    ...(ipRotateParams.onEndpointOutcome && {
      onEndpointOutcome: ipRotateParams.onEndpointOutcome,
    }),
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

  const outcomeReporter = buildOutcomeReporter(params);
  const fetchResult: FetchRetryResult = await fetchWithRetry({
    config: params.options.ipRotateConfig,
    targetUrl: params.url,
    counters: params.options.ipRotateCounters,
    headers: params.headers,
    method: METHOD_GET,
    wallClockSignal: params.wallClockSignal,
    ...params.options.ipRotateTuningEnv,
    ...(outcomeReporter && { onEndpointOutcome: outcomeReporter }),
  });

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
