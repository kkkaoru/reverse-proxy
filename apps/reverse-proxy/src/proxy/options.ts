// Proxy options creation from environment
// Execute with bun: wrangler dev

import { parseIpRotateConfig } from '../ip-rotate/client.ts';
import type { IpRotateConfig, ParsedConfig } from '../ip-rotate/types.ts';
import { DEFAULT_CACHE_VERSION } from './constants.ts';
import type { ProxyCacheEnv, ProxyCacheOptions, ProxyCacheStaticOptions } from './types.ts';

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

// Create options from environment
export const createOptionsFromEnv = (
  staticOptions: ProxyCacheStaticOptions,
  env: ProxyCacheEnv,
  counters: Map<string, number>,
): ProxyCacheOptions => ({
  enableLogging: staticOptions.enableLogging,
  enableCacheApi: env.ENABLE_CACHE_API === 'true',
  kv: env.KV,
  cacheVersion: env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
  ipRotateConfig: parseIpRotateConfigFromEnv(env),
  ipRotateCounters: counters,
});
