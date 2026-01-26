// Test file for playwright.ts
// Execute with bun: bun run test

import { afterEach, beforeEach, expect, it, type MockInstance, vi } from 'vitest';
import { handlePlaywrightRequest, PLAYWRIGHT_PATH, type PlaywrightEnv } from '../src/playwright.ts';

interface MockKVNamespace {
  get: MockInstance;
  put: MockInstance;
}

interface MockResponse {
  status: () => number;
  headers: () => Record<string, string>;
  text: () => Promise<string>;
}

interface MockPage {
  goto: MockInstance;
  content: MockInstance;
}

interface MockContext {
  newPage: MockInstance;
  close: MockInstance;
}

interface MockBrowser {
  newContext: MockInstance;
  close: MockInstance;
}

const CONTENT_TYPE_HTML: string = 'text/html; charset=utf-8';
const CONTENT_TYPE_JSON: string = 'application/json; charset=utf-8';

const createMockKV = (): MockKVNamespace => ({
  get: vi.fn(),
  put: vi.fn(),
});

const createMockResponse = (
  content: string,
  status: number,
  contentType: string,
): MockResponse => ({
  status: (): number => status,
  headers: (): Record<string, string> => ({ 'content-type': contentType }),
  text: (): Promise<string> => Promise.resolve(content),
});

const createMockPage = (content: string, status: number, contentType: string): MockPage => ({
  goto: vi.fn().mockResolvedValue(createMockResponse(content, status, contentType)),
  content: vi.fn().mockResolvedValue(content),
});

const createMockContext = (page: MockPage): MockContext => ({
  newPage: vi.fn().mockResolvedValue(page),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockBrowser = (context: MockContext): MockBrowser => ({
  newContext: vi.fn().mockResolvedValue(context),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockEnv = (
  kv?: MockKVNamespace,
  logRequests?: string,
  cacheVersion: string = 'v5',
): PlaywrightEnv => ({
  BROWSER: {} as PlaywrightEnv['BROWSER'],
  KV: kv as unknown as KVNamespace,
  LOG_REQUESTS: logRequests,
  CACHE_VERSION: cacheVersion,
});

const createRequest = (url: string): Request =>
  new Request(`http://localhost${PLAYWRIGHT_PATH}?url=${encodeURIComponent(url)}`);

const createRequestWithParams = (params: string): Request =>
  new Request(`http://localhost${PLAYWRIGHT_PATH}?${params}`);

vi.mock('@cloudflare/playwright', () => ({
  launch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('PLAYWRIGHT_PATH exports correct path constant', () => {
  expect(PLAYWRIGHT_PATH).toBe('/playwright');
});

it('returns 400 when url parameter is missing', async () => {
  const env: PlaywrightEnv = createMockEnv();
  const request: Request = new Request(`http://localhost${PLAYWRIGHT_PATH}`);

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).toStrictEqual({ error: 'Query parameter "url" is required.' });
});

it('returns 400 when url parameter is invalid', async () => {
  const env: PlaywrightEnv = createMockEnv();
  const request: Request = createRequestWithParams('url=not-a-valid-url');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).toStrictEqual({ error: 'Query parameter "url" must be a valid absolute URL.' });
});

it('returns cached content with x-cache HIT header when cache exists', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  const cachedData: string = JSON.stringify({
    content: '<html>cached</html>',
    contentType: CONTENT_TYPE_HTML,
  });
  mockKV.get.mockResolvedValue(cachedData);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/page');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('HIT');
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const body: string = await response.text();
  expect(body).toBe('<html>cached</html>');
});

it('returns cached JSON content with correct content-type', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  const cachedData: string = JSON.stringify({
    content: '{"data":"cached"}',
    contentType: CONTENT_TYPE_JSON,
  });
  mockKV.get.mockResolvedValue(cachedData);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/api');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('HIT');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body: string = await response.text();
  expect(body).toBe('{"data":"cached"}');
});

it('skips cache when disable_kv is true', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(
    JSON.stringify({ content: '<html>cached</html>', contentType: CONTENT_TYPE_HTML }),
  );

  const mockPage: MockPage = createMockPage('<html>fresh</html>', 200, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequestWithParams('url=https://example.com/page&disable_kv=true');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('MISS');
  expect(mockKV.get).not.toHaveBeenCalled();
});

it('skips cache when disable_cache is true', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(
    JSON.stringify({ content: '<html>cached</html>', contentType: CONTENT_TYPE_HTML }),
  );

  const mockPage: MockPage = createMockPage('<html>fresh</html>', 200, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequestWithParams(
    'url=https://example.com/page&disable_cache=true',
  );

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('MISS');
  expect(mockKV.get).not.toHaveBeenCalled();
});

it('fetches HTML page and caches on cache miss', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const mockPage: MockPage = createMockPage('<html>fetched</html>', 200, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/page');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('MISS');
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const body: string = await response.text();
  expect(body).toBe('<html>fetched</html>');
  expect(mockKV.put).toHaveBeenCalled();
});

it('fetches JSON response and returns raw body without HTML wrapper', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const jsonContent: string = '{"results":[{"id":1}]}';
  const mockPage: MockPage = createMockPage(jsonContent, 200, CONTENT_TYPE_JSON);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/api/data');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-cache')).toBe('MISS');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body: string = await response.text();
  expect(body).toBe('{"results":[{"id":1}]}');
  expect(mockPage.content).not.toHaveBeenCalled();
});

it('does not cache 4xx responses', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);

  const mockPage: MockPage = createMockPage('<html>not found</html>', 404, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/missing');

  const response: Response = await handlePlaywrightRequest(request, env);

  expect(response.status).toBe(200);
  expect(mockKV.put).not.toHaveBeenCalled();
});

it('returns 502 when browser fetch fails after retries', async () => {
  vi.useFakeTimers();
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Browser launch failed'));

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/page');

  const responsePromise: Promise<Response> = handlePlaywrightRequest(request, env);

  await vi.runAllTimersAsync();

  const response: Response = await responsePromise;

  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body).toStrictEqual({ error: 'Browser fetch failed: Browser launch failed' });
  vi.useRealTimers();
});

it('logs events when LOG_REQUESTS is TRUE', async () => {
  const consoleSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation(() => {});
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(
    JSON.stringify({ content: '<html>cached</html>', contentType: CONTENT_TYPE_HTML }),
  );

  const env: PlaywrightEnv = createMockEnv(mockKV, 'TRUE');
  const request: Request = createRequest('https://example.com/page');

  await handlePlaywrightRequest(request, env);

  expect(consoleSpy).toHaveBeenCalled();
  consoleSpy.mockRestore();
});

it('does not log events when LOG_REQUESTS is not set', async () => {
  const consoleSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation(() => {});
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(
    JSON.stringify({ content: '<html>cached</html>', contentType: CONTENT_TYPE_HTML }),
  );

  const env: PlaywrightEnv = createMockEnv(mockKV);
  const request: Request = createRequest('https://example.com/page');

  await handlePlaywrightRequest(request, env);

  expect(consoleSpy).not.toHaveBeenCalled();
  consoleSpy.mockRestore();
});

it('uses custom cache version from env when CACHE_VERSION is set', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const mockPage: MockPage = createMockPage('<html>fetched</html>', 200, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV, undefined, 'v10');
  const request: Request = createRequest('https://example.com');

  await handlePlaywrightRequest(request, env);

  expect(mockKV.put).toHaveBeenCalledWith(
    'playwright-v10::https://example.com',
    expect.any(String),
    expect.objectContaining({ expirationTtl: 432000 }),
  );
});

it('sets cache TTL to 5 days when storing in KV', async () => {
  const mockKV: MockKVNamespace = createMockKV();
  mockKV.get.mockResolvedValue(null);
  mockKV.put.mockResolvedValue(undefined);

  const mockPage: MockPage = createMockPage('<html>fetched</html>', 200, CONTENT_TYPE_HTML);
  const mockContext: MockContext = createMockContext(mockPage);
  const mockBrowser: MockBrowser = createMockBrowser(mockContext);

  const { launch } = await import('@cloudflare/playwright');
  (launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

  const env: PlaywrightEnv = createMockEnv(mockKV, undefined, 'v5');
  const request: Request = createRequest('https://example.com/page');

  await handlePlaywrightRequest(request, env);

  expect(mockKV.put).toHaveBeenCalledWith(
    'playwright-v5::https://example.com/page',
    expect.any(String),
    expect.objectContaining({ expirationTtl: 432000 }),
  );
});
