// biome-ignore-all lint/nursery/noSecrets: Public URLs and dummy tokens are fixtures.
// Execute with bun run test. Only the remote browser launcher is mocked.
import { afterEach, expect, it, vi } from 'vitest';
import type { PlaywrightEnv } from './handler.ts';
import { handlePlaywrightRequest } from './handler.ts';

const mocks: { launch: ReturnType<typeof vi.fn> } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@cloudflare/playwright', () => ({ launch: mocks.launch }));
const env: PlaywrightEnv = {
  BROWSER: { fetch: vi.fn<typeof fetch>() },
  CACHE_VERSION: 'test',
  KITESURF_ACCOUNT_ID: '00000000000000000000000000000000',
  KITESURF_API_TOKEN: 'test-token',
  KITESURF_HTML_RULES: '{"https://example.com/":"Example Domain"}',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('serves verified Kitesurf HTML through the actual handler without launching Playwright', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        meta: { status: 200 },
        result: '<body>Example Domain</body>',
      }),
    ),
  );
  const response: Response = await handlePlaywrightRequest(
    new Request('https://proxy.example/playwright?url=https%3A%2F%2Fexample.com%2F'),
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<body>Example Domain</body>');
  expect(mocks.launch).not.toHaveBeenCalled();
});

it('launches and closes Playwright when an enabled Kitesurf request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Kitesurf unavailable')));
  const close = vi.fn();
  const contextClose = vi.fn();
  mocks.launch.mockResolvedValue({
    close,
    newContext: vi.fn().mockResolvedValue({
      close: contextClose,
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue({
          status: () => 200,
          headers: () => ({ 'content-type': 'text/html' }),
        }),
        content: vi.fn().mockResolvedValue('<body>Chromium result</body>'),
      }),
    }),
  });
  const response: Response = await handlePlaywrightRequest(
    new Request('https://proxy.example/playwright?url=https%3A%2F%2Fexample.com%2F'),
    env,
  );
  expect(await response.text()).toBe('<body>Chromium result</body>');
  expect(mocks.launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(contextClose).toHaveBeenCalledTimes(1);
});

it('uses the Browser binding through the real handler without an API token', async () => {
  const quickAction = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      meta: { status: 200 },
      result: '<body>Example Domain</body>',
    }),
  );
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  const response: Response = await handlePlaywrightRequest(
    new Request('https://proxy.example/playwright?url=https%3A%2F%2Fexample.com%2F'),
    {
      ...env,
      KITESURF_API_TOKEN: undefined,
      KITESURF_ACCOUNT_ID: undefined,
      BROWSER: { fetch: request, quickAction },
    },
  );
  expect(await response.text()).toBe('<body>Example Domain</body>');
  expect(quickAction).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
});

it('rejects missing targets before calling either engine', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const response: Response = await handlePlaywrightRequest(
    new Request('https://proxy.example/playwright'),
    env,
  );
  expect(response.status).toBe(400);
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
