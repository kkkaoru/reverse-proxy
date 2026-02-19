// Proxy options creation from environment
// Execute with bun: wrangler dev

import {
  filterEndpointsByBannedRegions,
  loadEndpointsJsonFromKv,
  parseBannedRegions,
  parseIpRotateConfig,
} from '../ip-rotate/client.ts';
import type { IpRotateConfig, ParsedConfig } from '../ip-rotate/types.ts';
import { DEFAULT_CACHE_VERSION } from './constants.ts';
import type {
  IpRotateTuningEnv,
  ProxyCacheEnv,
  ProxyCacheOptions,
  ProxyCacheStaticOptions,
} from './types.ts';

interface CreateOptionsParams {
  readonly staticOptions: ProxyCacheStaticOptions;
  readonly env: ProxyCacheEnv;
  readonly counters: Map<string, number>;
  readonly ipRotateConfig?: IpRotateConfig;
}

// Parse IP rotation config from environment
export const parseIpRotateConfigFromEnv = (env: ProxyCacheEnv): IpRotateConfig | undefined => {
  const parsed: ParsedConfig = parseIpRotateConfig({
    endpointsJson: env.IP_ROTATE_ENDPOINTS,
    authType: env.IP_ROTATE_AUTH_TYPE,
    apiKey: env.IP_ROTATE_API_KEY,
    accessKeyId: env.IP_ROTATE_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.IP_ROTATE_AWS_SECRET_ACCESS_KEY,
    region: env.IP_ROTATE_AWS_REGION,
  });

  return parsed.success ? parsed.config : undefined;
};

// Apply banned region filtering to config
const applyBannedRegionFilter = (config: IpRotateConfig, env: ProxyCacheEnv): IpRotateConfig => {
  const bannedRegions: ReadonlySet<string> = parseBannedRegions(env.IP_ROTATE_BANNED_REGIONS);
  if (bannedRegions.size === 0) return config;
  return { ...config, endpoints: filterEndpointsByBannedRegions(config.endpoints, bannedRegions) };
};

// Resolve IP rotation config: env var first, then KV fallback
export const resolveIpRotateConfig = async (
  env: ProxyCacheEnv,
): Promise<IpRotateConfig | undefined> => {
  const fromEnv: IpRotateConfig | undefined = parseIpRotateConfigFromEnv(env);
  if (fromEnv) return applyBannedRegionFilter(fromEnv, env);

  const endpointsJson: string | null = await loadEndpointsJsonFromKv(env.KV);
  if (!endpointsJson) return undefined;

  const parsed: ParsedConfig = parseIpRotateConfig({
    endpointsJson,
    authType: env.IP_ROTATE_AUTH_TYPE,
    apiKey: env.IP_ROTATE_API_KEY,
    accessKeyId: env.IP_ROTATE_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.IP_ROTATE_AWS_SECRET_ACCESS_KEY,
    region: env.IP_ROTATE_AWS_REGION,
  });
  return parsed.success ? applyBannedRegionFilter(parsed.config, env) : undefined;
};

// Build tuning env from ProxyCacheEnv
const buildTuningEnv = (env: ProxyCacheEnv): IpRotateTuningEnv => ({
  envDefaultTimeoutMs: env.DEFAULT_TIMEOUT_MS,
  envHealthTtlMs: env.IP_ROTATE_HEALTH_TTL_MS,
  envEwmaHalfLifeMs: env.IP_ROTATE_EWMA_HALF_LIFE_MS,
  envMaxHedgeAttempts: env.IP_ROTATE_MAX_HEDGE_ATTEMPTS,
  envHedgeDelayMs: env.IP_ROTATE_HEDGE_DELAY_MS,
  envThrottleBaseDelayMs: env.IP_ROTATE_THROTTLE_BASE_DELAY_MS,
  envThrottleTtlMs: env.IP_ROTATE_THROTTLE_TTL_MS,
  envHedgeSuppressThreshold: env.IP_ROTATE_HEDGE_SUPPRESS_THRESHOLD,
});

// Create options from environment
export const createOptionsFromEnv = (params: CreateOptionsParams): ProxyCacheOptions => ({
  enableLogging: params.staticOptions.enableLogging,
  enableCacheApi: params.env.ENABLE_CACHE_API === 'true',
  kv: params.env.KV,
  cacheVersion: params.env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
  ipRotateConfig: params.ipRotateConfig ?? parseIpRotateConfigFromEnv(params.env),
  ipRotateCounters: params.counters,
  ipRotateTuningEnv: buildTuningEnv(params.env),
  healthCoordinator: params.env.HEALTH_COORDINATOR,
});
