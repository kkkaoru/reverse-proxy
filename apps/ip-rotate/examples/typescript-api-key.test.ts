import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FetchOptions, RequestConfig } from './typescript-api-key.ts';
import {
  buildUrl,
  createHeaders,
  createJsonHeaders,
  fetchWithApiKey,
} from './typescript-api-key.ts';

describe('typescript-api-key', () => {
  describe('createHeaders', () => {
    test('returns headers with x-api-key', () => {
      const result = createHeaders('test-api-key');

      expect(result).toStrictEqual({
        'x-api-key': 'test-api-key',
      });
    });

    test('returns headers with different api key', () => {
      const result = createHeaders('another-key-12345');

      expect(result).toStrictEqual({
        'x-api-key': 'another-key-12345',
      });
    });

    test('returns headers with empty api key', () => {
      const result = createHeaders('');

      expect(result).toStrictEqual({
        'x-api-key': '',
      });
    });
  });

  describe('createJsonHeaders', () => {
    test('returns headers with x-api-key and Content-Type', () => {
      const result = createJsonHeaders('test-api-key');

      expect(result).toStrictEqual({
        'x-api-key': 'test-api-key',
        'Content-Type': 'application/json',
      });
    });

    test('returns headers with different api key and Content-Type', () => {
      const result = createJsonHeaders('my-secret-key');

      expect(result).toStrictEqual({
        'x-api-key': 'my-secret-key',
        'Content-Type': 'application/json',
      });
    });

    test('returns headers with empty api key and Content-Type', () => {
      const result = createJsonHeaders('');

      expect(result).toStrictEqual({
        'x-api-key': '',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('buildUrl', () => {
    test('builds URL with endpoint and path', () => {
      const result = buildUrl('https://api.example.com', '/users');

      expect(result).toStrictEqual('https://api.example.com/users');
    });

    test('builds URL with trailing slash endpoint', () => {
      const result = buildUrl('https://api.example.com/', '/users');

      expect(result).toStrictEqual('https://api.example.com//users');
    });

    test('builds URL with empty path', () => {
      const result = buildUrl('https://api.example.com', '');

      expect(result).toStrictEqual('https://api.example.com');
    });

    test('builds URL with query parameters in path', () => {
      const result = buildUrl('https://api.example.com', '/users?id=123');

      expect(result).toStrictEqual('https://api.example.com/users?id=123');
    });

    test('builds URL with complex path', () => {
      const result = buildUrl(
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        '/api/v1/data',
      );

      expect(result).toStrictEqual(
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/api/v1/data',
      );
    });
  });

  describe('fetchWithApiKey', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('calls fetch with correct URL and headers for GET request', async () => {
      const mockResponse = Response.json({ success: true });
      const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(mockResponse),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config: RequestConfig = {
        endpoint: 'https://api.example.com',
        apiKey: 'test-key',
        path: '/users',
      };
      const options: FetchOptions = {
        method: 'GET',
        headers: { 'x-api-key': 'test-key' },
      };

      await fetchWithApiKey(config, options);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toStrictEqual('https://api.example.com/users');
      expect(calledInit.method).toStrictEqual('GET');
      expect(calledInit.headers).toStrictEqual({
        'x-api-key': 'test-key',
      });
    });

    test('calls fetch with correct URL and headers for POST request with body', async () => {
      const mockResponse = Response.json({ created: true });
      const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(mockResponse),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config: RequestConfig = {
        endpoint: 'https://api.example.com',
        apiKey: 'post-key',
        path: '/data',
      };
      const options: FetchOptions = {
        method: 'POST',
        headers: { 'x-api-key': 'post-key', 'Content-Type': 'application/json' },
        body: '{"key":"value"}',
      };

      await fetchWithApiKey(config, options);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toStrictEqual('https://api.example.com/data');
      expect(calledInit.method).toStrictEqual('POST');
      expect(calledInit.headers).toStrictEqual({
        'x-api-key': 'post-key',
        'Content-Type': 'application/json',
      });
      expect(calledInit.body).toStrictEqual('{"key":"value"}');
    });

    test('returns response from fetch', async () => {
      const expectedData = { id: 1, name: 'test' };
      const mockResponse = Response.json(expectedData);
      const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(mockResponse),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config: RequestConfig = {
        endpoint: 'https://api.example.com',
        apiKey: 'key',
        path: '/item',
      };
      const options: FetchOptions = {
        method: 'GET',
        headers: { 'x-api-key': 'key' },
      };

      const response = await fetchWithApiKey(config, options);
      const data = await response.json();

      expect(data).toStrictEqual(expectedData);
    });

    test('handles DELETE request', async () => {
      const mockResponse = new Response(null, { status: 204 });
      const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(mockResponse),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config: RequestConfig = {
        endpoint: 'https://api.example.com',
        apiKey: 'delete-key',
        path: '/item/123',
      };
      const options: FetchOptions = {
        method: 'DELETE',
        headers: { 'x-api-key': 'delete-key' },
      };

      const response = await fetchWithApiKey(config, options);

      expect(response.status).toStrictEqual(204);
      const [, calledInit] = mockFetch.mock.calls[0];
      expect(calledInit.method).toStrictEqual('DELETE');
    });

    test('handles PUT request with body', async () => {
      const mockResponse = Response.json({ updated: true });
      const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(mockResponse),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const config: RequestConfig = {
        endpoint: 'https://api.example.com',
        apiKey: 'put-key',
        path: '/item/456',
      };
      const options: FetchOptions = {
        method: 'PUT',
        headers: { 'x-api-key': 'put-key', 'Content-Type': 'application/json' },
        body: '{"name":"updated"}',
      };

      await fetchWithApiKey(config, options);

      const [, calledInit] = mockFetch.mock.calls[0];
      expect(calledInit.method).toStrictEqual('PUT');
      expect(calledInit.body).toStrictEqual('{"name":"updated"}');
    });
  });
});
