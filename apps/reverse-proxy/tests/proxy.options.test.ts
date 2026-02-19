// Options utilities tests

import { describe, expect, it, vi } from 'vitest';
import {
  createOptionsFromEnv,
  parseIpRotateConfigFromEnv,
  resolveIpRotateConfig,
} from '../src/proxy/options.ts';
import type { ProxyCacheEnv, ProxyCacheStaticOptions } from '../src/proxy/types.ts';

interface MockKVNamespace {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

const createMockKV = (): MockKVNamespace => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
});

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

describe('resolveIpRotateConfig', () => {
  it('should return config from env var when available', async () => {
    const env: ProxyCacheEnv = {
      IP_ROTATE_ENDPOINTS:
        '{"example.com":[{"endpoint":"https://api1.example.com","apiKey":"key1"}]}',
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(config?.auth.type).toBe('api-key');
  });

  it('should return undefined when no env var and no KV', async () => {
    const env: ProxyCacheEnv = {};
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeUndefined();
  });

  it('should return undefined when KV returns null', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    mockKV.get.mockResolvedValue(null);
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeUndefined();
    expect(mockKV.get).toHaveBeenCalledWith('ip-rotate-endpoints', 'text');
  });

  it('should return config from KV when env var is missing', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    const endpointsJson: string = JSON.stringify({
      'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
    });
    mockKV.get.mockResolvedValue(endpointsJson);
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(config?.auth.type).toBe('api-key');
  });

  it('should return undefined when KV returns invalid JSON', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    mockKV.get.mockResolvedValue('invalid-json');
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeUndefined();
  });

  it('should return undefined when KV has endpoints but missing API key', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    const endpointsJson: string = JSON.stringify({
      'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
    });
    mockKV.get.mockResolvedValue(endpointsJson);
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_AUTH_TYPE: 'api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeUndefined();
  });

  it('should prefer env var over KV', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    mockKV.get.mockResolvedValue('should-not-be-called');
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_ENDPOINTS:
        '{"example.com":[{"endpoint":"https://api1.example.com","apiKey":"key1"}]}',
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  it('should filter banned regions from env var config', async () => {
    const env: ProxyCacheEnv = {
      IP_ROTATE_ENDPOINTS: JSON.stringify({
        'example.com': [
          { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
          { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
          { endpoint: 'https://c.execute-api.ap-northeast-1.amazonaws.com/proxy', apiKey: 'key3' },
        ],
      }),
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
      IP_ROTATE_BANNED_REGIONS: 'eu-west-1',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(config?.endpoints['example.com']).toHaveLength(2);
    expect(config?.endpoints['example.com']?.[0]?.apiKey).toBe('key1');
    expect(config?.endpoints['example.com']?.[1]?.apiKey).toBe('key3');
  });

  it('should filter banned regions from KV config', async () => {
    const mockKV: MockKVNamespace = createMockKV();
    const endpointsJson: string = JSON.stringify({
      'example.com': [
        { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
        { endpoint: 'https://b.execute-api.eu-west-2.amazonaws.com/proxy', apiKey: 'key2' },
      ],
    });
    mockKV.get.mockResolvedValue(endpointsJson);
    const env: ProxyCacheEnv = {
      KV: mockKV as unknown as KVNamespace,
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
      IP_ROTATE_BANNED_REGIONS: 'eu-west-2',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(config?.endpoints['example.com']).toHaveLength(1);
    expect(config?.endpoints['example.com']?.[0]?.apiKey).toBe('key1');
  });

  it('should not filter when IP_ROTATE_BANNED_REGIONS is empty', async () => {
    const env: ProxyCacheEnv = {
      IP_ROTATE_ENDPOINTS: JSON.stringify({
        'example.com': [
          { endpoint: 'https://a.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key1' },
        ],
      }),
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'test-api-key',
      IP_ROTATE_BANNED_REGIONS: '',
    };
    const config = await resolveIpRotateConfig(env);
    expect(config).toBeDefined();
    expect(config?.endpoints['example.com']).toHaveLength(1);
  });
});

describe('createOptionsFromEnv', () => {
  it('should create options with defaults', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: true };
    const env: ProxyCacheEnv = {};
    const counters = new Map<string, number>();

    const options = createOptionsFromEnv({ staticOptions, env, counters });

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

    const options = createOptionsFromEnv({ staticOptions, env, counters });

    expect(options.enableLogging).toBe(false);
    expect(options.enableCacheApi).toBe(true);
    expect(options.cacheVersion).toBe('v2');
  });

  it('should use provided ipRotateConfig when given', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: true };
    const env: ProxyCacheEnv = {};
    const counters = new Map<string, number>();
    const ipRotateConfig = {
      endpoints: {
        'example.com': [{ endpoint: 'https://api1.example.com', apiKey: 'key1' }],
      },
      auth: { type: 'api-key' as const, apiKey: 'test-key' },
    };

    const options = createOptionsFromEnv({ staticOptions, env, counters, ipRotateConfig });

    expect(options.ipRotateConfig).toBe(ipRotateConfig);
  });

  it('should pass tuning env from env', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: true };
    const env: ProxyCacheEnv = {
      DEFAULT_TIMEOUT_MS: '3000',
      IP_ROTATE_HEALTH_TTL_MS: '120000',
      IP_ROTATE_MAX_HEDGE_ATTEMPTS: '4',
    };
    const counters = new Map<string, number>();

    const options = createOptionsFromEnv({ staticOptions, env, counters });

    expect(options.ipRotateTuningEnv?.envDefaultTimeoutMs).toBe('3000');
    expect(options.ipRotateTuningEnv?.envHealthTtlMs).toBe('120000');
    expect(options.ipRotateTuningEnv?.envMaxHedgeAttempts).toBe('4');
  });

  it('should leave tuning env fields undefined when not set', () => {
    const staticOptions: ProxyCacheStaticOptions = { enableLogging: true };
    const env: ProxyCacheEnv = {};
    const counters = new Map<string, number>();

    const options = createOptionsFromEnv({ staticOptions, env, counters });

    expect(options.ipRotateTuningEnv?.envDefaultTimeoutMs).toBeUndefined();
    expect(options.ipRotateTuningEnv?.envHealthTtlMs).toBeUndefined();
  });
});
