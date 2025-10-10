import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createProxyCacheMiddleware } from '../src/middleware.ts';
import { setupEnvironment } from './helpers.ts';

const queueBinding = 'CACHE_WARM_QUEUE';

const createAppWithMiddleware = (
  options: { enableLogging: boolean } = { enableLogging: true },
): Hono => {
  const app = new Hono();
  app.use('*', createProxyCacheMiddleware({ ...options, queueBinding }));
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
    const response = await app.request(
      '/',
      { method: 'POST' },
      { CACHE_WARM_QUEUE: { send: vi.fn() } as unknown as Queue },
    );
    expect(response.status).toBe(404);
  });
});
