// biome-ignore-all lint/nursery/noSecrets: Synthetic HTML and dummy credentials are test fixtures.
// Execute with bun run test.
import type { Mock } from 'vitest';
import { afterEach, expect, it, vi } from 'vitest';
import type { FetchPageResponse } from './core.ts';
import { fetchHtmlWithKitesurfFallback } from './kitesurf.ts';

const env = {
  KITESURF_ACCOUNT_ID: '00000000000000000000000000000000',
  KITESURF_API_TOKEN: 'test-token',
  KITESURF_HTML_RULES: '{"https://example.com/":"Example Domain"}',
};
const fallback: Mock<() => Promise<FetchPageResponse>> = vi.fn(async () => ({
  content: 'chromium',
  contentType: 'text/html',
  status: 200,
}));
const params: Parameters<typeof fetchHtmlWithKitesurfFallback>[0] = {
  env,
  url: 'https://example.com/',
  fallback,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('returns verified HTML with origin status and requests the selected engine', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 201 },
      result: '<html><body>Example Domain</body></html>',
    }),
  );
  vi.stubGlobal('fetch', request);
  expect(await fetchHtmlWithKitesurfFallback(params)).toStrictEqual({
    content: '<html><body>Example Domain</body></html>',
    contentType: 'text/html; charset=utf-8',
    status: 201,
  });
  expect(request.mock.calls[0]?.[0]).toBe(
    'https://api.cloudflare.com/client/v4/accounts/00000000000000000000000000000000/browser-rendering/content?browser=kitesurf&cacheTTL=0',
  );
  expect(fallback).not.toHaveBeenCalled();
});

it.each([
  {},
  { ...env, KITESURF_API_TOKEN: undefined },
  { ...env, KITESURF_ACCOUNT_ID: 'invalid' },
  { ...env, KITESURF_HTML_RULES: '{' },
  { ...env, KITESURF_HTML_RULES: '[]' },
  { ...env, KITESURF_HTML_RULES: '{"https://example.com/":" "}' },
])('skips optional engine for disabled or invalid settings %j', async (settings) => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  expect(await fetchHtmlWithKitesurfFallback({ ...params, env: settings })).toStrictEqual({
    content: 'chromium',
    contentType: 'text/html',
    status: 200,
  });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledTimes(1);
});

it.each([
  'https://example.com/other',
  'http://example.com/',
  'https://user:pass@example.com/',
  'invalid',
])('does not broaden URL authorization: %s', async (url) => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({ ...params, url });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  [],
  {},
  { success: false },
  { success: true, result: 'Example Domain', meta: {} },
  { success: true, result: 'Example Domain', meta: { status: 404 } },
  { success: true, result: 'Example Domain', meta: { status: 301 } },
  { success: true, result: '<body></body>', meta: { status: 200 } },
  { success: true, result: '<body><script>Example Domain</script></body>', meta: { status: 200 } },
  {
    success: true,
    result: '<head><title>Example Domain</title></head><body></body>',
    meta: { status: 200 },
  },
  { success: true, result: '<body>Example Domain Just a moment</body>', meta: { status: 200 } },
  {
    success: true,
    result: '<body><script>window.location.href = "/top/";</script></body>',
    meta: { status: 200 },
  },
  { success: true, result: '<body>Example Domain �����</body>', meta: { status: 200 } },
])('rejects invalid or incomplete HTML %j', async (payload) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
  expect(await fetchHtmlWithKitesurfFallback(params)).toStrictEqual({
    content: 'chromium',
    contentType: 'text/html',
    status: 200,
  });
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('routes known unsupported redirects directly to Playwright even when allowlisted', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({
    ...params,
    url: 'https://race.netkeiba.com/',
    env: { ...env, KITESURF_HTML_RULES: '{"https://race.netkeiba.com/":"Race"}' },
  });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('uses Kitesurf for the race redirect with its verified wait mode', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 200 },
      result: '<body>開催レース一覧</body>',
    }),
  );
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({
    ...params,
    url: 'https://race.netkeiba.com/',
    env: {
      ...env,
      KITESURF_HTML_RULES:
        '{"https://race.netkeiba.com/":{"text":"開催レース一覧","waitUntil":"networkidle2"}}',
    },
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(fallback).not.toHaveBeenCalled();
});

it('accepts a complete page containing an unrelated navigation handler', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        meta: { status: 200 },
        result:
          '<body>Example Domain<script>function navigate() { window.location.href = "/other"; }</script></body>',
      }),
    ),
  );
  await fetchHtmlWithKitesurfFallback(params);
  expect(fallback).not.toHaveBeenCalled();
});

it('uses the individually verified wait mode for dynamic HTML', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 200 },
      result: '<body>Example Domain</body>',
    }),
  );
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({
    ...params,
    env: {
      ...env,
      KITESURF_HTML_RULES:
        '{"https://example.com/":{"text":"Example Domain","waitUntil":"networkidle2"}}',
    },
  });
  expect(request.mock.calls[0]?.[1].body).toBe(
    '{"url":"https://example.com/","gotoOptions":{"waitUntil":"networkidle2","timeout":15000}}',
  );
  expect(fallback).not.toHaveBeenCalled();
});

it.each([
  '{"https://example.com/":{"text":"Example Domain","waitUntil":"bad"}}',
  '{"https://example.com/":{"text":" ","waitUntil":"networkidle2"}}',
  '{"https://example.com/":null}',
  '{"https://example.com/":42}',
  '{"https://example.com/":{"text":[],"waitUntil":"networkidle2"}}',
  '{"https://example.com/":{"text":[1],"waitUntil":"networkidle2"}}',
  '{"https://example.com/":{"text":["Example Domain"," "],"waitUntil":"networkidle2"}}',
])('skips invalid per-operation options %s', async (rules) => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({ ...params, env: { ...env, KITESURF_HTML_RULES: rules } });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('requires all verified result-page markers', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 200 },
      result: '<body>レーニス アストラアヴィス 払戻金 9,360円</body>',
    }),
  );
  vi.stubGlobal('fetch', request);
  const result = await fetchHtmlWithKitesurfFallback({
    ...params,
    url: 'https://nar.netkeiba.com/race/result.html?race_id=202635070601',
    env: {
      ...env,
      KITESURF_HTML_RULES:
        '{"https://nar.netkeiba.com/race/result.html?race_id=202635070601":{"text":["レーニス","アストラアヴィス","9,360円"],"waitUntil":"networkidle2"}}',
    },
  });
  expect(result).toStrictEqual({
    content: '<body>レーニス アストラアヴィス 払戻金 9,360円</body>',
    contentType: 'text/html; charset=utf-8',
    status: 200,
  });
  expect(fallback).not.toHaveBeenCalled();
});

it('falls back when one required result marker is absent from the body', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        meta: { status: 200 },
        result: '<body>レーニス アストラアヴィス<script>"9,360円"</script></body>',
      }),
    ),
  );
  await fetchHtmlWithKitesurfFallback({
    ...params,
    env: {
      ...env,
      KITESURF_HTML_RULES:
        '{"https://example.com/":{"text":["レーニス","アストラアヴィス","9,360円"],"waitUntil":"networkidle2"}}',
    },
  });
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('does not generalize a verified result rule to other race identifiers', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({
    ...params,
    url: 'https://nar.netkeiba.com/race/result.html?race_id=202635070602',
    env: {
      ...env,
      KITESURF_HTML_RULES:
        '{"https://nar.netkeiba.com/race/result.html?race_id=202635070601":{"text":["レーニス","9,360円"],"waitUntil":"networkidle2"}}',
    },
  });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('falls back for quota errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota', { status: 429 })));
  await fetchHtmlWithKitesurfFallback(params);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('falls back for malformed JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad json')));
  await fetchHtmlWithKitesurfFallback(params);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('falls back for timeout without retrying optional engine', async () => {
  const request = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback(params);
  expect(request).toHaveBeenCalledTimes(1);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('prefers the verified binding options without requiring API credentials', async () => {
  const quickAction = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 200 },
      result: '<body>Example Domain</body>',
    }),
  );
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  await fetchHtmlWithKitesurfFallback({
    ...params,
    env: { BROWSER: { fetch: request, quickAction }, KITESURF_HTML_RULES: env.KITESURF_HTML_RULES },
  });
  expect(quickAction).toHaveBeenCalledWith('content', {
    browser: 'kitesurf',
    cacheTTL: 0,
    url: 'https://example.com/',
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 },
  });
  expect(request).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('bounds a stalled binding RPC and falls back once', async () => {
  vi.useFakeTimers();
  const quickAction = vi.fn(() => new Promise<Response>(() => undefined));
  const result = fetchHtmlWithKitesurfFallback({
    ...params,
    env: {
      BROWSER: { fetch: vi.fn<typeof fetch>(), quickAction },
      KITESURF_HTML_RULES: env.KITESURF_HTML_RULES,
    },
  });
  await vi.advanceTimersByTimeAsync(15000);
  expect(await result).toStrictEqual({
    content: 'chromium',
    contentType: 'text/html',
    status: 200,
  });
  expect(quickAction).toHaveBeenCalledTimes(1);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('cancels a late binding response after fallback', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const quickAction = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve(new Response(new ReadableStream({ cancel }))), 16000);
      }),
  );
  const result = fetchHtmlWithKitesurfFallback({
    ...params,
    env: {
      BROWSER: { fetch: vi.fn<typeof fetch>(), quickAction },
      KITESURF_HTML_RULES: env.KITESURF_HTML_RULES,
    },
  });
  await vi.advanceTimersByTimeAsync(15000);
  await result;
  await vi.advanceTimersByTimeAsync(1000);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it('does not swallow fallback errors', async () => {
  const failingFallback = vi.fn().mockRejectedValue(new Error('Chromium failed'));
  await expect(
    fetchHtmlWithKitesurfFallback({ ...params, env: {}, fallback: failingFallback }),
  ).rejects.toThrow('Chromium failed');
  expect(failingFallback).toHaveBeenCalledTimes(1);
});
