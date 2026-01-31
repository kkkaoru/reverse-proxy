// Options utilities tests

import { describe, expect, it } from 'vitest';
import { createOptionsFromEnv, parseIpRotateConfigFromEnv } from '../src/proxy/options.ts';
import type { ProxyCacheEnv, ProxyCacheStaticOptions } from '../src/proxy/types.ts';

describe('parseIpRotateConfigFromEnv', () => {
  it('should return undefined when no IP rotate config', () => {
    const env: ProxyCacheEnv = {};
    expect(parseIpRotateConfigFromEnv(env)).toBeUndefined();
  });

  it('should return undefined for invalid config', () => {
    const env: ProxyCacheEnv = {
      IP_ROTATE_ENDPOINTS: 'invalid-json',
    };
    expect(parseIpRotateConfigFromEnv(env)).toBeUndefined();
  });

  it('should parse valid API key config', () => {
    const env: ProxyCacheEnv = {
      IP_ROTATE_ENDPOINTS:
        '{"example.com":[{"endpoint":"https://api1.example.com","apiKey":"key1"}]}',
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = parseIpRotateConfigFromEnv(env);
    expect(config).toBeDefined();
    expect(config?.auth.type).toBe('api-key');
  });
});

describe('createOptionsFromEnv', () => {
  it('should create options with defaults', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: true };
    const env: ProxyCacheEnv = {};
    const counters = new Map<string, number>();

    const options = createOptionsFromEnv(staticOptions, env, counters);

    expect(options.enableLogging).toBe(true);
    expect(options.enableCacheApi).toBe(false);
    expect(options.cacheVersion).toBe('v1');
    expect(options.ipRotateConfig).toBeUndefined();
    expect(options.ipRotateCounters).toBe(counters);
  });

  it('should use env values when provided', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: false };
    const env: ProxyCacheEnv = {
      ENABLE_CACHE_API: 'true',
      CACHE_VERSION: 'v2',
    };
    const counters = new Map<string, number>();

    const options = createOptionsFromEnv(staticOptions, env, counters);

    expect(options.enableLogging).toBe(false);
    expect(options.enableCacheApi).toBe(true);
    expect(options.cacheVersion).toBe('v2');
  });
});
