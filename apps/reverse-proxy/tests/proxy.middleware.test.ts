import { Hono } from 'hono';
import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import { createProxyCacheMiddleware } from '../src/proxy/middleware.ts';
import type { ProxyCacheEnv, ProxyCacheStaticOptions } from '../src/proxy/types.ts';
import { setupEnvironment } from './helpers.ts';

const CONTENT_TYPE_HTML_EUCJP: string = 'text/html; charset=euc-jp';
const CONTENT_TYPE_HTML_UTF8: string = 'text/html; charset=utf-8';
const CONTENT_TYPE_HTML: string = 'text/html';
const DEFAULT_ENV: ProxyCacheEnv = { CACHE_VERSION: 'v1' };

interface MockKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

type TestApp = Hono<{ Bindings: ProxyCacheEnv }>;

const createMockKV = (): MockKV => ({
  get: vi.fn(),
  put: vi.fn(),
});

const createAppWithMiddleware = (
  options: ProxyCacheStaticOptions = { enableLogging: true },
): TestApp => {
  const app: TestApp = new Hono();
  app.use('*', createProxyCacheMiddleware(options));
  app.get('/downstream', (c) => c.text('downstream'));
  return app;
};

const requestWithEnv = async (app: TestApp, path: string, init?: RequestInit): Promise<Response> =>
  app.request(path, init, DEFAULT_ENV);

interface KvRequestOptions {
  app: TestApp;
  path: string;
  kv: MockKV;
  init?: RequestInit;
}

const requestWithKvEnv = async (options: KvRequestOptions): Promise<Response> =>
  options.app.request(options.path, options.init, {
    CACHE_VERSION: 'v1',
    KV: options.kv as unknown as KVNamespace,
  });

describe('proxy middleware routing', () => {
  it('calls next for non-root path', async () => {
    setupEnvironment();
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/downstream');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('downstream');
  });

  it('passes through unsupported methods', async () => {
    setupEnvironment();
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/', { method: 'PATCH' });
    expect(response.status).toBe(404);
  });

  it('skips caching for 4xx responses', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    fetchSpy.mockClear();
    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/missing')}`;

    const firstAttempt: Response = await requestWithEnv(app, encodedTarget);
    expect(firstAttempt.status).toBe(404);
    expect(await firstAttempt.text()).toBe('missing');

    const secondAttempt: Response = await requestWithEnv(app, encodedTarget);
    expect(secondAttempt.status).toBe(404);
    expect(await secondAttempt.text()).toBe('missing');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('proxy middleware encoding', () => {
  it('converts euc-jp response to utf-8', async () => {
    const japaneseContent: string = 'Japanese content: test';
    const eucjpBytes: Blob = new Blob([
      new Uint8Array([...iconv.encode(japaneseContent, 'euc-jp')]),
    ]);
    setupEnvironment(() =>
      Promise.resolve(
        new Response(eucjpBytes, {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_HTML_EUCJP },
        }),
      ),
    );
    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/eucjp')}`;

    const response: Response = await requestWithEnv(app, encodedTarget);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_HTML_UTF8);
    expect(await response.text()).toBe(japaneseContent);
  });

  it('returns utf-8 response unchanged', async () => {
    const utf8Content: string = '<html><body>UTF-8 content</body></html>';
    setupEnvironment(() =>
      Promise.resolve(
        new Response(utf8Content, {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_HTML_UTF8 },
        }),
      ),
    );
    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/utf8')}`;

    const response: Response = await requestWithEnv(app, encodedTarget);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE_HTML_UTF8);
    expect(await response.text()).toBe(utf8Content);
  });
});

describe('proxy middleware KV cache', () => {
  it('returns cached content from KV on hit', async () => {
    setupEnvironment();
    const mockKV: MockKV = createMockKV();
    const cachedData: string = JSON.stringify({
      content: '<html>cached from kv</html>',
      contentType: CONTENT_TYPE_HTML,
    });
    mockKV.get.mockResolvedValue(cachedData);

    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/kv-cached')}`;

    const response: Response = await requestWithKvEnv({ app, path: encodedTarget, kv: mockKV });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>cached from kv</html>');
    expect(mockKV.get).toHaveBeenCalled();
  });

  it('stores response in KV on cache miss', async () => {
    const content: string = '<html>fresh content</html>';
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(
        new Response(content, {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_HTML },
        }),
      ),
    );
    fetchSpy.mockClear();
    const mockKV: MockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);
    mockKV.put.mockResolvedValue(undefined);

    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/kv-miss')}`;

    const response: Response = await requestWithKvEnv({ app, path: encodedTarget, kv: mockKV });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content);
    expect(mockKV.put).toHaveBeenCalledWith(
      'proxy-v1::https://example.com/kv-miss',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 432000 }),
    );
  });

  it('does not store 4xx response in KV', async () => {
    setupEnvironment(() => Promise.resolve(new Response('not found', { status: 404 })));
    const mockKV: MockKV = createMockKV();
    mockKV.get.mockResolvedValue(null);

    const app: TestApp = createAppWithMiddleware();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/not-found')}`;

    const response: Response = await requestWithKvEnv({ app, path: encodedTarget, kv: mockKV });

    expect(response.status).toBe(404);
    expect(mockKV.put).not.toHaveBeenCalled();
  });
});

interface BatchResultItem {
  result: string;
  httpStatus: number;
  url: string;
  body: string;
}

interface ErrorResponseBody {
  error: string;
}

describe('proxy middleware POST batch', () => {
  it('handles POST request with valid urls array', async () => {
    setupEnvironment(() =>
      Promise.resolve(
        new Response('<html>ok</html>', {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_HTML },
        }),
      ),
    );
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://example.com'] }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body: BatchResultItem[] = await response.json();
    expect(body.length).toBe(1);
    const first: BatchResultItem | undefined = body[0];
    expect(first?.result).toBe('success');
  });

  it('returns 400 for invalid JSON body', async () => {
    setupEnvironment();
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/', {
      method: 'POST',
      body: 'invalid json',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    const body: ErrorResponseBody = await response.json();
    expect(body.error).toBe('Request body must be valid JSON');
  });

  it('returns 400 for missing urls field', async () => {
    setupEnvironment();
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/', {
      method: 'POST',
      body: JSON.stringify({ other: 'field' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    const body: ErrorResponseBody = await response.json();
    expect(body.error).toBe('Request body must contain "urls" array');
  });

  it('blocks SSRF attempts in batch request', async () => {
    setupEnvironment();
    const app: TestApp = createAppWithMiddleware();
    const response: Response = await requestWithEnv(app, '/', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://localhost/admin'] }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    const body: BatchResultItem[] = await response.json();
    const first: BatchResultItem | undefined = body[0];
    expect(first?.result).toBe('ssrf_blocked');
    expect(first?.httpStatus).toBe(422);
  });
});
