// IP Rotation client tests
// Execute with bun: bun test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  AUTH_TYPE_API_KEY,
  AUTH_TYPE_IAM,
  getNextEndpoint,
  isIpRotateTarget,
  parseIpRotateConfig,
  rewriteUrlForIpRotate,
} from '../src/ip-rotate/client.ts';
import type { IpRotateConfig } from '../src/ip-rotate/types.ts';

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
