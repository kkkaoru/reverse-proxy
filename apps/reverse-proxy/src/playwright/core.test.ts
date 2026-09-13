// biome-ignore-all lint/nursery/noSecrets: Public HTML fixtures and dummy API keys contain no credentials.
// Execute with bun run test. Regression cases captured from production IP-rotate responses.
import { afterEach, expect, it, vi } from 'vitest';
import {
  type FetchPageResponse,
  handleCoreRequest,
  type PlaywrightCoreEnv,
  parseIpRotateConfigFromEnv,
} from './core.ts';

afterEach(() => vi.unstubAllGlobals());

it.each([
  '<html><head><title>302 Found</title></head><body><p>The document has moved <a href="/top/">here</a>.</p></body></html>',
  '<script>window.location.href = "/top/";</script>',
])(
  'continues to browser rendering instead of returning an IP-rotate stub %s',
  async (html: string) => {
    const env: PlaywrightCoreEnv = {
      CACHE_VERSION: 'v2',
      IP_ROTATE_ENDPOINTS:
        '{"example.com":[{"endpoint":"https://gateway.example.test","apiKey":"dummy"}]}',
      IP_ROTATE_AUTH_TYPE: 'api-key',
      IP_ROTATE_API_KEY: 'dummy',
    };
    const fetchPage: () => Promise<FetchPageResponse> = vi.fn().mockResolvedValue({
      content: '<body>Complete rendered page</body>',
      contentType: 'text/html; charset=utf-8',
      status: 200,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })));
    const response: Response = await handleCoreRequest({
      env,
      targetUrl: 'https://example.com/',
      cacheKey: 'unused',
      disableKv: true,
      disableCache: true,
      fetchPage,
      ipRotateOptions: { config: parseIpRotateConfigFromEnv(env), counters: new Map() },
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<body>Complete rendered page</body>');
  },
);
