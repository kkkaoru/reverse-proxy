// IP Rotation fetch tests
// Execute with bun: bun test

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchWithAuth } from '../src/ip-rotate/fetch.ts';
import type { FetchWithAuthParams, IpRotateAuth } from '../src/ip-rotate/types.ts';

const createApiKeyAuth = (): IpRotateAuth => ({
  type: 'api-key',
  apiKey: 'test-api-key-12345',
});

const createIamAuth = (): IpRotateAuth => ({
  type: 'iam',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
});

type FetchFn = typeof globalThis.fetch;

describe('ip-rotate-fetch', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchWithAuth with API Key', () => {
    test('should include x-api-key header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: { 'user-agent': 'test-agent' },
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.['x-api-key']).toBe('test-api-key-12345');
    });

    test('should preserve original headers', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: { 'user-agent': 'test-agent', accept: 'application/json' },
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.['user-agent']).toBe('test-agent');
      expect(capturedHeaders?.accept).toBe('application/json');
    });

    test('should call fetch with correct URL', async () => {
      let capturedUrl: string | undefined;
      globalThis.fetch = vi.fn().mockImplementation((url: unknown) => {
        capturedUrl = String(url);
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedUrl).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path');
    });

    test('should use correct HTTP method', async () => {
      let capturedMethod: string | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedMethod = init?.method;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'POST',
      };

      await fetchWithAuth(params);

      expect(capturedMethod).toBe('POST');
    });

    test('should return response from fetch', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response('success body', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createApiKeyAuth(),
        headers: {},
        method: 'GET',
      };

      const response = await fetchWithAuth(params);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('success body');
    });
  });

  describe('fetchWithAuth with IAM', () => {
    test('should include authorization header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.authorization).toBeDefined();
      expect(capturedHeaders?.authorization?.startsWith('AWS4-HMAC-SHA256')).toBe(true);
    });

    test('should include x-amz-date header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.['x-amz-date']).toBeDefined();
    });

    test('should include host header', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as FetchFn;

      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: createIamAuth(),
        headers: {},
        method: 'GET',
      };

      await fetchWithAuth(params);

      expect(capturedHeaders?.host).toBe('abc123.execute-api.us-east-1.amazonaws.com');
    });
  });

  describe('fetchWithAuth error handling', () => {
    test('should throw error for unsupported auth type', async () => {
      const params: FetchWithAuthParams = {
        url: new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/path'),
        auth: { type: 'unknown' } as unknown as IpRotateAuth,
        headers: {},
        method: 'GET',
      };

      await expect(fetchWithAuth(params)).rejects.toThrow('Unsupported auth type: unknown');
    });
  });
});
