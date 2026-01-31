import { describe, expect, it } from 'vitest';
import { app, type ReverseProxyBindings } from '../src/app.ts';
import { setupEnvironment } from './helpers.ts';

const DEFAULT_ENV: ReverseProxyBindings = { CACHE_VERSION: 'v1', ENABLE_CACHE_API: 'true' };

describe('reverse proxy cache behavior', () => {
  it('caches upstream response and serves cached content on subsequent request', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(
        new Response('upstream-body', {
          status: 200,
          headers: { 'set-cookie': 'a=b' },
        }),
      ),
    );
    fetchSpy.mockClear();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/data')}`;

    const firstResponse: Response = await app.request(encodedTarget, {}, DEFAULT_ENV);
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe('upstream-body');

    const cachedResponse: Response = await app.request(encodedTarget, {}, DEFAULT_ENV);
    expect(cachedResponse.status).toBe(200);
    expect(await cachedResponse.text()).toBe('upstream-body');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed upstream responses', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(new Response('fail', { status: 502 })),
    );
    fetchSpy.mockClear();
    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/error')}`;

    const firstAttempt: Response = await app.request(encodedTarget, {}, DEFAULT_ENV);
    expect(firstAttempt.status).toBe(502);
    expect(await firstAttempt.text()).toBe('fail');

    const secondAttempt: Response = await app.request(encodedTarget, {}, DEFAULT_ENV);
    expect(secondAttempt.status).toBe(502);
    expect(await secondAttempt.text()).toBe('fail');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('reverse proxy cache deletion', () => {
  it('returns 404 when deleting without cached entry', async () => {
    setupEnvironment(() => Promise.resolve(new Response('cached', { status: 200 })));

    const deleteResponse: Response = await app.request(
      `/?url=${encodeURIComponent('https://example.com/data')}`,
      { method: 'DELETE' },
      DEFAULT_ENV,
    );
    expect(deleteResponse.status).toBe(404);
    const deleteJson = (await deleteResponse.json()) as { deleted: boolean; error: string };
    expect(deleteJson.deleted).toBe(false);
  });
});
