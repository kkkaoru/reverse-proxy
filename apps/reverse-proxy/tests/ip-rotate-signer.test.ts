// IP Rotation signer tests
// Execute with bun: bun test

import { describe, expect, test } from 'vitest';
import { signRequest } from '../src/ip-rotate/signer.ts';
import type { IpRotateAuthIam } from '../src/ip-rotate/types.ts';

const createTestAuth = (): IpRotateAuthIam => ({
  type: 'iam',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
});

describe('ip-rotate-signer', () => {
  describe('signRequest', () => {
    test('should return signed request with url', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.url).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
    });

    test('should include host header in signed headers', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.headers.host).toBe('abc123.execute-api.us-east-1.amazonaws.com');
    });

    test('should include authorization header', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.headers.authorization).toBeDefined();
      const authHeader = result.headers.authorization ?? '';
      expect(authHeader.startsWith('AWS4-HMAC-SHA256')).toBe(true);
    });

    test('should include x-amz-date header', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.headers['x-amz-date']).toBeDefined();
    });

    test('should preserve custom headers', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: { 'x-custom-header': 'custom-value' },
        auth,
      });
      expect(result.headers['x-custom-header']).toBe('custom-value');
    });

    test('should work with POST method', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'POST',
        headers: {},
        body: '{"key":"value"}',
        auth,
      });
      expect(result.headers.authorization).toBeDefined();
    });

    test('should handle URL with query string', async () => {
      const auth = createTestAuth();
      const url = new URL(
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path?foo=bar&baz=qux',
      );
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.url).toBe(
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path?foo=bar&baz=qux',
      );
    });

    test('should use execute-api service in signature', async () => {
      const auth = createTestAuth();
      const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.headers.authorization).toContain('execute-api');
    });

    test('should use region from auth in signature', async () => {
      const auth: IpRotateAuthIam = {
        type: 'iam',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'eu-west-1',
      };
      const url = new URL('https://abc123.execute-api.eu-west-1.amazonaws.com/proxy/path');
      const result = await signRequest({
        url,
        method: 'GET',
        headers: {},
        auth,
      });
      expect(result.headers.authorization).toContain('eu-west-1');
    });
  });
});
