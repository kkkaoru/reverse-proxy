// IP Rotation client tests
// Execute with bun: bun test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  AUTH_TYPE_API_KEY,
  AUTH_TYPE_IAM,
  extractRegionFromEndpoint,
  filterEndpointsByBannedRegions,
  getNextEndpoint,
  isIpRotateTarget,
  KV_KEY_IP_ROTATE_ENDPOINTS,
  loadEndpointsJsonFromKv,
  parseBannedRegions,
  parseIpRotateConfig,
  pickRandomElement,
  rewriteUrlForIpRotate,
  selectRegionAwareEndpoint,
} from '../src/ip-rotate/client.ts';
import type {
  EndpointWithApiKey,
  IpRotateConfig,
  IpRotateEndpoints,
} from '../src/ip-rotate/types.ts';

const createTestConfig = (): IpRotateConfig => ({
  endpoints: {
    'api.example.com': [
      {
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'key-us-east-1',
      },
      {
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
        apiKey: 'key-eu-west-1',
      },
    ],
    'data.example.org': [
      {
        endpoint: 'https://ghi789.execute-api.ap-northeast-1.amazonaws.com/proxy',
        apiKey: 'key-ap-northeast-1',
      },
    ],
  },
  auth: {
    type: 'api-key',
    apiKey: 'test-api-key',
  },
});

describe('ip-rotate-client', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AUTH_TYPE constants', () => {
    test('AUTH_TYPE_API_KEY should be api-key', () => {
      expect(AUTH_TYPE_API_KEY).toBe('api-key');
    });

    test('AUTH_TYPE_IAM should be iam', () => {
      expect(AUTH_TYPE_IAM).toBe('iam');
    });
  });

  describe('isIpRotateTarget', () => {
    test('should return true for configured domain', () => {
      const config = createTestConfig();
      expect(isIpRotateTarget(config, 'api.example.com')).toBe(true);
    });

    test('should return true for second configured domain', () => {
      const config = createTestConfig();
      expect(isIpRotateTarget(config, 'data.example.org')).toBe(true);
    });

    test('should return false for unconfigured domain', () => {
      const config = createTestConfig();
      expect(isIpRotateTarget(config, 'other.example.com')).toBe(false);
    });

    test('should return false for empty domain', () => {
      const config = createTestConfig();
      expect(isIpRotateTarget(config, '')).toBe(false);
    });
  });

  describe('getNextEndpoint', () => {
    test('should return first endpoint with apiKey on first call', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const result = getNextEndpoint({ config, domain: 'api.example.com', counters });
      expect(result).toEqual({
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'key-us-east-1',
      });
    });

    test('should return second endpoint with apiKey on second call', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      getNextEndpoint({ config, domain: 'api.example.com', counters });
      const result = getNextEndpoint({ config, domain: 'api.example.com', counters });
      expect(result).toEqual({
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
        apiKey: 'key-eu-west-1',
      });
    });

    test('should cycle back to first endpoint on third call', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      getNextEndpoint({ config, domain: 'api.example.com', counters });
      getNextEndpoint({ config, domain: 'api.example.com', counters });
      const result = getNextEndpoint({ config, domain: 'api.example.com', counters });
      expect(result).toEqual({
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'key-us-east-1',
      });
    });

    test('should return null for unconfigured domain', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const result = getNextEndpoint({ config, domain: 'other.example.com', counters });
      expect(result).toBeNull();
    });

    test('should return null for empty endpoints array', () => {
      const config: IpRotateConfig = {
        endpoints: { 'empty.example.com': [] },
        auth: { type: 'api-key', apiKey: 'test' },
      };
      const counters = new Map<string, number>();
      const result = getNextEndpoint({ config, domain: 'empty.example.com', counters });
      expect(result).toBeNull();
    });

    test('should track counters per domain', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      getNextEndpoint({ config, domain: 'api.example.com', counters });
      const result = getNextEndpoint({ config, domain: 'data.example.org', counters });
      expect(result).toEqual({
        endpoint: 'https://ghi789.execute-api.ap-northeast-1.amazonaws.com/proxy',
        apiKey: 'key-ap-northeast-1',
      });
    });
  });

  describe('rewriteUrlForIpRotate', () => {
    test('should rewrite URL with endpoint base and return apiKey', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const targetUrl = new URL('https://api.example.com/path/to/resource');
      const result = rewriteUrlForIpRotate(config, targetUrl, counters);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url.toString()).toBe(
          'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path/to/resource',
        );
        expect(result.apiKey).toBe('key-us-east-1');
      }
    });

    test('should preserve query string', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const targetUrl = new URL('https://api.example.com/path?foo=bar&baz=qux');
      const result = rewriteUrlForIpRotate(config, targetUrl, counters);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url.toString()).toBe(
          'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path?foo=bar&baz=qux',
        );
        expect(result.apiKey).toBe('key-us-east-1');
      }
    });

    test('should return failure for unconfigured domain', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const targetUrl = new URL('https://other.example.com/path');
      const result = rewriteUrlForIpRotate(config, targetUrl, counters);
      expect(result.success).toBe(false);
    });

    test('should handle root path', () => {
      const config = createTestConfig();
      const counters = new Map<string, number>();
      const targetUrl = new URL('https://api.example.com/');
      const result = rewriteUrlForIpRotate(config, targetUrl, counters);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url.toString()).toBe(
          'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/',
        );
        expect(result.apiKey).toBe('key-us-east-1');
      }
    });
  });

  describe('parseIpRotateConfig', () => {
    test('should parse API Key config successfully', () => {
      const endpointsJson = JSON.stringify({
        'api.example.com': [{ endpoint: 'https://endpoint1.com', apiKey: 'key1' }],
      });
      const result = parseIpRotateConfig({
        endpointsJson,
        authType: 'api-key',
        apiKey: 'test-key',
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.config.auth.type).toBe('api-key');
      }
    });

    test('should parse IAM config successfully', () => {
      const endpointsJson = JSON.stringify({
        'api.example.com': [{ endpoint: 'https://endpoint1.com', apiKey: 'key1' }],
      });
      const result = parseIpRotateConfig({
        endpointsJson,
        authType: 'iam',
        apiKey: undefined,
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.config.auth.type).toBe('iam');
      }
    });

    test('should return error for missing endpoints', () => {
      const result = parseIpRotateConfig({
        endpointsJson: undefined,
        authType: 'api-key',
        apiKey: 'test-key',
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('IP_ROTATE_ENDPOINTS is required');
      }
    });

    test('should return error for invalid JSON', () => {
      const result = parseIpRotateConfig({
        endpointsJson: 'invalid json',
        authType: 'api-key',
        apiKey: 'test-key',
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('IP_ROTATE_ENDPOINTS must be valid JSON');
      }
    });

    test('should return error for missing API key', () => {
      const endpointsJson = JSON.stringify({
        'api.example.com': [{ endpoint: 'https://endpoint1.com', apiKey: 'key1' }],
      });
      const result = parseIpRotateConfig({
        endpointsJson,
        authType: 'api-key',
        apiKey: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('IP_ROTATE_API_KEY is required for api-key auth');
      }
    });

    test('should return error for missing IAM credentials', () => {
      const endpointsJson = JSON.stringify({
        'api.example.com': [{ endpoint: 'https://endpoint1.com', apiKey: 'key1' }],
      });
      const result = parseIpRotateConfig({
        endpointsJson,
        authType: 'iam',
        apiKey: undefined,
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('AWS credentials are required for IAM auth');
      }
    });

    test('should default to api-key auth type', () => {
      const endpointsJson = JSON.stringify({
        'api.example.com': [{ endpoint: 'https://endpoint1.com', apiKey: 'key1' }],
      });
      const result = parseIpRotateConfig({
        endpointsJson,
        authType: undefined,
        apiKey: 'test-key',
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.config.auth.type).toBe('api-key');
      }
    });
  });
});

describe('extractRegionFromEndpoint', () => {
  test('should extract region from standard API Gateway endpoint', () => {
    expect(
      extractRegionFromEndpoint('https://abc123.execute-api.us-east-1.amazonaws.com/proxy'),
    ).toBe('us-east-1');
  });

  test('should extract region from eu-west-1 endpoint', () => {
    expect(
      extractRegionFromEndpoint('https://def456.execute-api.eu-west-1.amazonaws.com/proxy'),
    ).toBe('eu-west-1');
  });

  test('should extract region from ap-northeast-1 endpoint', () => {
    expect(
      extractRegionFromEndpoint('https://ghi789.execute-api.ap-northeast-1.amazonaws.com/proxy'),
    ).toBe('ap-northeast-1');
  });

  test('should return null for non-API Gateway endpoint', () => {
    expect(extractRegionFromEndpoint('https://example.com/proxy')).toBeNull();
  });

  test('should return null for empty string', () => {
    expect(extractRegionFromEndpoint('')).toBeNull();
  });
});

describe('selectRegionAwareEndpoint', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('should select endpoint from untried region first', () => {
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.ap-northeast-1.amazonaws.com/proxy', apiKey: 'key3' },
    ];
    const triedRegions = new Set<string>(['us-east-1']);
    const triedEndpointIndices = new Set<number>([0]);
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.region).toBe('eu-west-1');
    expect(result?.index).toBe(1);
  });

  test('should select untried endpoint in tried region when all regions tried', () => {
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key3' },
    ];
    const triedRegions = new Set<string>(['us-east-1', 'eu-west-1']);
    const triedEndpointIndices = new Set<number>([0, 2]);
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.index).toBe(1);
  });

  test('should return null when all endpoints tried', () => {
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
    ];
    const triedRegions = new Set<string>(['us-east-1', 'eu-west-1']);
    const triedEndpointIndices = new Set<number>([0, 1]);
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).toBeNull();
  });

  test('should select first endpoint when nothing tried with Math.random=0', () => {
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
    ];
    const triedRegions = new Set<string>();
    const triedEndpointIndices = new Set<number>();
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.index).toBe(0);
    expect(result?.region).toBe('us-east-1');
  });

  test('should handle empty endpoints array', () => {
    const endpoints: readonly EndpointWithApiKey[] = [];
    const triedRegions = new Set<string>();
    const triedEndpointIndices = new Set<number>();
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).toBeNull();
  });

  test('should prioritize untried region over untried endpoint in tried region', () => {
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key3' },
    ];
    const triedRegions = new Set<string>(['us-east-1']);
    const triedEndpointIndices = new Set<number>([0]);
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.region).toBe('eu-west-1');
    expect(result?.index).toBe(2);
  });

  test('should select different region with different Math.random value', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.ap-northeast-1.amazonaws.com/proxy', apiKey: 'key3' },
    ];
    const triedRegions = new Set<string>();
    const triedEndpointIndices = new Set<number>();
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.index).toBe(2);
    expect(result?.region).toBe('ap-northeast-1');
  });

  test('should select different untried endpoint with different Math.random value', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const endpoints: readonly EndpointWithApiKey[] = [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key3' },
    ];
    const triedRegions = new Set<string>(['us-east-1']);
    const triedEndpointIndices = new Set<number>([0]);
    const result = selectRegionAwareEndpoint({ endpoints, triedRegions, triedEndpointIndices });
    expect(result).not.toBeNull();
    expect(result?.index).toBe(2);
  });
});

test('pickRandomElement should return undefined for empty array', () => {
  expect(pickRandomElement([])).toBeUndefined();
});

test('pickRandomElement should return the only element for single-element array', () => {
  expect(pickRandomElement(['only'])).toBe('only');
});

test('pickRandomElement should return element based on Math.random', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  expect(pickRandomElement(['a', 'b', 'c'])).toBe('b');
  vi.restoreAllMocks();
});

test('pickRandomElement should return first element when Math.random is 0', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  expect(pickRandomElement(['a', 'b', 'c'])).toBe('a');
  vi.restoreAllMocks();
});

test('pickRandomElement should return last element when Math.random is 0.99', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  expect(pickRandomElement(['a', 'b', 'c'])).toBe('c');
  vi.restoreAllMocks();
});

test('KV_KEY_IP_ROTATE_ENDPOINTS should be ip-rotate-endpoints', () => {
  expect(KV_KEY_IP_ROTATE_ENDPOINTS).toBe('ip-rotate-endpoints');
});

describe('loadEndpointsJsonFromKv', () => {
  test('should return null when KV is undefined', async () => {
    const result = await loadEndpointsJsonFromKv(undefined);
    expect(result).toBeNull();
  });

  test('should return null when KV returns null', async () => {
    const mockKV = { get: vi.fn().mockResolvedValue(null) };
    const result = await loadEndpointsJsonFromKv(mockKV as unknown as KVNamespace);
    expect(result).toBeNull();
    expect(mockKV.get).toHaveBeenCalledWith('ip-rotate-endpoints', 'text');
  });

  test('should return JSON string from KV', async () => {
    const endpointsJson =
      '{"example.com":[{"endpoint":"https://api1.example.com","apiKey":"key1"}]}';
    const mockKV = { get: vi.fn().mockResolvedValue(endpointsJson) };
    const result = await loadEndpointsJsonFromKv(mockKV as unknown as KVNamespace);
    expect(result).toBe(
      '{"example.com":[{"endpoint":"https://api1.example.com","apiKey":"key1"}]}',
    );
    expect(mockKV.get).toHaveBeenCalledWith('ip-rotate-endpoints', 'text');
  });
});

test('parseBannedRegions returns empty set for undefined', () => {
  const result: ReadonlySet<string> = parseBannedRegions(undefined);
  expect(result.size).toBe(0);
});

test('parseBannedRegions returns empty set for empty string', () => {
  const result: ReadonlySet<string> = parseBannedRegions('');
  expect(result.size).toBe(0);
});

test('parseBannedRegions parses comma-separated regions', () => {
  const result: ReadonlySet<string> = parseBannedRegions('eu-west-1,eu-west-2,eu-central-1');
  expect(result.size).toBe(3);
  expect(result.has('eu-west-1')).toBe(true);
  expect(result.has('eu-west-2')).toBe(true);
  expect(result.has('eu-central-1')).toBe(true);
});

test('parseBannedRegions trims whitespace around regions', () => {
  const result: ReadonlySet<string> = parseBannedRegions(' eu-west-1 , eu-west-2 ');
  expect(result.size).toBe(2);
  expect(result.has('eu-west-1')).toBe(true);
  expect(result.has('eu-west-2')).toBe(true);
});

test('parseBannedRegions ignores empty segments from extra commas', () => {
  const result: ReadonlySet<string> = parseBannedRegions('eu-west-1,,eu-west-2,');
  expect(result.size).toBe(2);
  expect(result.has('eu-west-1')).toBe(true);
  expect(result.has('eu-west-2')).toBe(true);
});

test('filterEndpointsByBannedRegions removes EU endpoints', () => {
  const endpoints: IpRotateEndpoints = {
    'example.com': [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
      { endpoint: 'https://c.execute-api.ap-northeast-1.amazonaws.com/proxy', apiKey: 'key3' },
    ],
  };
  const banned: ReadonlySet<string> = new Set(['eu-west-1']);
  const result: IpRotateEndpoints = filterEndpointsByBannedRegions(endpoints, banned);
  expect(result['example.com']).toHaveLength(2);
  expect(result['example.com']?.[0]?.apiKey).toBe('key1');
  expect(result['example.com']?.[1]?.apiKey).toBe('key3');
});

test('filterEndpointsByBannedRegions preserves non-banned endpoints', () => {
  const endpoints: IpRotateEndpoints = {
    'example.com': [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.us-west-2.amazonaws.com/proxy', apiKey: 'key2' },
    ],
  };
  const banned: ReadonlySet<string> = new Set(['eu-west-1']);
  const result: IpRotateEndpoints = filterEndpointsByBannedRegions(endpoints, banned);
  expect(result['example.com']).toHaveLength(2);
});

test('filterEndpointsByBannedRegions returns empty array when all banned', () => {
  const endpoints: IpRotateEndpoints = {
    'example.com': [
      { endpoint: 'https://a.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-2.amazonaws.com/proxy', apiKey: 'key2' },
    ],
  };
  const banned: ReadonlySet<string> = new Set(['eu-west-1', 'eu-west-2']);
  const result: IpRotateEndpoints = filterEndpointsByBannedRegions(endpoints, banned);
  expect(result['example.com']).toHaveLength(0);
});

test('filterEndpointsByBannedRegions preserves non-API-Gateway endpoints', () => {
  const endpoints: IpRotateEndpoints = {
    'example.com': [
      { endpoint: 'https://custom-proxy.example.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
    ],
  };
  const banned: ReadonlySet<string> = new Set(['eu-west-1']);
  const result: IpRotateEndpoints = filterEndpointsByBannedRegions(endpoints, banned);
  expect(result['example.com']).toHaveLength(1);
  expect(result['example.com']?.[0]?.apiKey).toBe('key1');
});

test('filterEndpointsByBannedRegions filters across multiple domains', () => {
  const endpoints: IpRotateEndpoints = {
    'example.com': [
      { endpoint: 'https://a.execute-api.us-east-1.amazonaws.com/proxy', apiKey: 'key1' },
      { endpoint: 'https://b.execute-api.eu-west-1.amazonaws.com/proxy', apiKey: 'key2' },
    ],
    'other.com': [
      { endpoint: 'https://c.execute-api.eu-west-2.amazonaws.com/proxy', apiKey: 'key3' },
      { endpoint: 'https://d.execute-api.ap-northeast-1.amazonaws.com/proxy', apiKey: 'key4' },
    ],
  };
  const banned: ReadonlySet<string> = new Set(['eu-west-1', 'eu-west-2']);
  const result: IpRotateEndpoints = filterEndpointsByBannedRegions(endpoints, banned);
  expect(result['example.com']).toHaveLength(1);
  expect(result['example.com']?.[0]?.apiKey).toBe('key1');
  expect(result['other.com']).toHaveLength(1);
  expect(result['other.com']?.[0]?.apiKey).toBe('key4');
});
