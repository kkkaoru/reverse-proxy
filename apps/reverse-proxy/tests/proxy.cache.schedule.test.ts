import { describe, expect, it } from 'vitest';
import { app } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

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
    const encodedTarget = `/?url=${encodeURIComponent('https://example.com/data')}`;

    const firstResponse = await app.request(encodedTarget);
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe('upstream-body');

    const cachedResponse = await app.request(encodedTarget);
    expect(cachedResponse.status).toBe(200);
    expect(await cachedResponse.text()).toBe('upstream-body');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed upstream responses', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(new Response('fail', { status: 502 })),
    );
    fetchSpy.mockClear();
    const encodedTarget = `/?url=${encodeURIComponent('https://example.com/error')}`;

    const firstAttempt = await app.request(encodedTarget);
    expect(firstAttempt.status).toBe(502);
    expect(await firstAttempt.text()).toBe('fail');

    const secondAttempt = await app.request(encodedTarget);
    expect(secondAttempt.status).toBe(502);
    expect(await secondAttempt.text()).toBe('fail');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('reverse proxy cache deletion', () => {
  it('returns 404 when deleting without cached entry', async () => {
    setupEnvironment(() => Promise.resolve(new Response('cached', { status: 200 })));

    const deleteResponse = await app.request(
      `/?url=${encodeURIComponent('https://example.com/data')}`,
      { method: 'DELETE' },
    );
    expect(deleteResponse.status).toBe(404);
    const deleteJson = (await deleteResponse.json()) as { deleted: boolean; error: string };
    expect(deleteJson.deleted).toBe(false);
  });
});
