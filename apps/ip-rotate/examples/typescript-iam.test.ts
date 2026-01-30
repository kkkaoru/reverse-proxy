import { SignatureV4 } from '@smithy/signature-v4';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  AwsCredentials,
  RequestConfig,
  SignedRequestParams,
  SignerInput,
} from './typescript-iam.ts';
import {
  buildUrl,
  createSigner,
  createSignerInput,
  fetchWithIam,
  signAndFetch,
} from './typescript-iam.ts';

describe('createSigner', () => {
  test('creates SignatureV4 instance with credentials and region', () => {
    const credentials: AwsCredentials = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };
    const region = 'us-east-1';

    const signer = createSigner(credentials, region);

    expect(signer).toBeInstanceOf(SignatureV4);
  });

  test('creates SignatureV4 instance with different region', () => {
    const credentials: AwsCredentials = {
      accessKeyId: 'AKIAI44QH8DHBEXAMPLE',
      secretAccessKey: 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
    };
    const region = 'ap-northeast-1';

    const signer = createSigner(credentials, region);

    expect(signer).toBeInstanceOf(SignatureV4);
  });
});

describe('buildUrl', () => {
  test('builds URL object from endpoint and path', () => {
    const result = buildUrl('https://api.example.com', '/users');

    expect(result.toString()).toStrictEqual('https://api.example.com/users');
    expect(result.hostname).toStrictEqual('api.example.com');
    expect(result.pathname).toStrictEqual('/users');
  });

  test('builds URL with API Gateway endpoint', () => {
    const result = buildUrl('https://abc123.execute-api.us-east-1.amazonaws.com/proxy', '/ip');

    expect(result.toString()).toStrictEqual(
      'https://abc123.execute-api.us-east-1.amazonaws.com/proxy/ip',
    );
    expect(result.hostname).toStrictEqual('abc123.execute-api.us-east-1.amazonaws.com');
    expect(result.pathname).toStrictEqual('/proxy/ip');
  });

  test('builds URL with query parameters', () => {
    const result = buildUrl('https://api.example.com', '/search?q=test&limit=10');

    expect(result.toString()).toStrictEqual('https://api.example.com/search?q=test&limit=10');
    expect(result.search).toStrictEqual('?q=test&limit=10');
  });

  test('builds URL with empty path', () => {
    const result = buildUrl('https://api.example.com', '/');

    expect(result.toString()).toStrictEqual('https://api.example.com/');
    expect(result.pathname).toStrictEqual('/');
  });
});

describe('createSignerInput', () => {
  test('creates signer input for GET request', () => {
    const url = new URL('https://api.example.com/users');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.method).toStrictEqual('GET');
    expect(result.protocol).toStrictEqual('https:');
    expect(result.hostname).toStrictEqual('api.example.com');
    expect(result.path).toStrictEqual('/users');
    expect(result.headers).toStrictEqual({ host: 'api.example.com' });
    expect(result.body).toStrictEqual(undefined);
  });

  test('creates signer input for POST request with body', () => {
    const url = new URL('https://api.example.com/data');
    const params: SignedRequestParams = {
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.method).toStrictEqual('POST');
    expect(result.protocol).toStrictEqual('https:');
    expect(result.hostname).toStrictEqual('api.example.com');
    expect(result.path).toStrictEqual('/data');
    expect(result.headers).toStrictEqual({
      'Content-Type': 'application/json',
      host: 'api.example.com',
    });
    expect(result.body).toStrictEqual('{"key":"value"}');
  });

  test('creates signer input with query parameters', () => {
    const url = new URL('https://api.example.com/search?q=test');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.path).toStrictEqual('/search?q=test');
  });

  test('creates signer input with existing headers', () => {
    const url = new URL('https://api.example.com/protected');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: { 'X-Custom-Header': 'custom-value' },
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.headers).toStrictEqual({
      'X-Custom-Header': 'custom-value',
      host: 'api.example.com',
    });
  });

  test('creates signer input for API Gateway URL', () => {
    const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/ip');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.protocol).toStrictEqual('https:');
    expect(result.hostname).toStrictEqual('abc123.execute-api.us-east-1.amazonaws.com');
    expect(result.path).toStrictEqual('/proxy/ip');
    expect(result.headers).toStrictEqual({
      host: 'abc123.execute-api.us-east-1.amazonaws.com',
    });
  });

  test('creates signer input for HTTP URL', () => {
    const url = new URL('http://api.example.com/data');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    const result: SignerInput = createSignerInput(params);

    expect(result.protocol).toStrictEqual('http:');
  });
});

describe('signAndFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('signs request and calls fetch with signed headers', async () => {
    const mockResponse = Response.json({ success: true });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      path: '/ip',
    };
    const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/ip');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    await signAndFetch(config, params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toStrictEqual('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/ip');
    expect(calledInit.method).toStrictEqual('GET');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.authorization).toBeDefined();
    expect(headers['x-amz-date']).toBeDefined();
  });

  test('signs POST request with body', async () => {
    const mockResponse = Response.json({ created: true });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      path: '/data',
    };
    const url = new URL('https://abc123.execute-api.us-east-1.amazonaws.com/proxy/data');
    const params: SignedRequestParams = {
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
    };

    await signAndFetch(config, params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0];
    expect(calledInit.method).toStrictEqual('POST');
    expect(calledInit.body).toStrictEqual('{"key":"value"}');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.authorization).toBeDefined();
  });

  test('returns response from fetch', async () => {
    const expectedData = { origin: '1.2.3.4' };
    const mockResponse = Response.json(expectedData);
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://api.example.com',
      region: 'us-west-2',
      credentials: {
        accessKeyId: 'AKIAI44QH8DHBEXAMPLE',
        secretAccessKey: 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
      },
      path: '/ip',
    };
    const url = new URL('https://api.example.com/ip');
    const params: SignedRequestParams = {
      method: 'GET',
      url,
      headers: {},
    };

    const response = await signAndFetch(config, params);
    const data = await response.json();

    expect(data).toStrictEqual(expectedData);
  });
});

describe('fetchWithIam', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fetches with IAM authentication for GET request', async () => {
    const mockResponse = Response.json({ success: true });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      path: '/ip',
    };

    await fetchWithIam(config, 'GET');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0];
    expect(calledInit.method).toStrictEqual('GET');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.authorization).toBeDefined();
  });

  test('fetches with IAM authentication for POST request with body', async () => {
    const mockResponse = Response.json({ created: true });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      region: 'ap-northeast-1',
      credentials: {
        accessKeyId: 'AKIAI44QH8DHBEXAMPLE',
        secretAccessKey: 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
      },
      path: '/data',
    };

    await fetchWithIam(config, 'POST', '{"key":"value"}');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, calledInit] = mockFetch.mock.calls[0];
    expect(calledInit.method).toStrictEqual('POST');
    expect(calledInit.body).toStrictEqual('{"key":"value"}');
  });

  test('returns response from IAM authenticated fetch', async () => {
    const expectedData = { id: 123, status: 'active' };
    const mockResponse = Response.json(expectedData);
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://api.example.com',
      region: 'eu-west-1',
      credentials: {
        accessKeyId: 'AKIAEXAMPLE123',
        secretAccessKey: 'secretKeyExample123',
      },
      path: '/status',
    };

    const response = await fetchWithIam(config, 'GET');
    const data = await response.json();

    expect(data).toStrictEqual(expectedData);
  });

  test('fetches with IAM authentication for DELETE request', async () => {
    const mockResponse = new Response(null, { status: 204 });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://api.example.com',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      path: '/item/123',
    };

    const response = await fetchWithIam(config, 'DELETE');

    expect(response.status).toStrictEqual(204);
    const [, calledInit] = mockFetch.mock.calls[0];
    expect(calledInit.method).toStrictEqual('DELETE');
  });

  test('fetches with IAM authentication for PUT request with body', async () => {
    const mockResponse = Response.json({ updated: true });
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(mockResponse),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const config: RequestConfig = {
      endpoint: 'https://api.example.com',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      path: '/item/456',
    };

    await fetchWithIam(config, 'PUT', '{"name":"updated"}');

    const [, calledInit] = mockFetch.mock.calls[0];
    expect(calledInit.method).toStrictEqual('PUT');
    expect(calledInit.body).toStrictEqual('{"name":"updated"}');
  });
});
