import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createProxyCacheMiddleware } from '../src/middleware.ts';
import { setupEnvironment } from './helpers.ts';

const createAppWithMiddleware = (
  options: { enableLogging: boolean } = { enableLogging: true },
): Hono => {
  const app = new Hono();
  app.use('*', createProxyCacheMiddleware({ ...options }));
  app.get('/downstream', (c) => c.text('downstream'));
  return app;
};

describe('proxy middleware routing', () => {
  it('calls next for non-root path', async () => {
    setupEnvironment();
    const app = createAppWithMiddleware();
    const response = await app.request('/downstream');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('downstream');
  });

  it('passes through unsupported methods', async () => {
    setupEnvironment();
    const app = createAppWithMiddleware();
    const response = await app.request('/', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('skips caching for 4xx responses', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    fetchSpy.mockClear();
    const app = createAppWithMiddleware();
    const encodedTarget = `/?url=${encodeURIComponent('https://example.com/missing')}`;

    const firstAttempt = await app.request(encodedTarget);
    expect(firstAttempt.status).toBe(404);
    expect(await firstAttempt.text()).toBe('missing');

    const secondAttempt = await app.request(encodedTarget);
    expect(secondAttempt.status).toBe(404);
    expect(await secondAttempt.text()).toBe('missing');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
