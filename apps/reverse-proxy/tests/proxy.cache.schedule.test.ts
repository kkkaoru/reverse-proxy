import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.ts';
import { processCacheWarmMessage } from '../src/middleware.ts';
import { setupEnvironment } from './helpers.ts';

interface QueueEnv {
  CACHE_WARM_QUEUE: Queue;
}

const createEnv = (queueSend: ReturnType<typeof vi.fn>): QueueEnv => ({
  CACHE_WARM_QUEUE: {
    send: queueSend,
  } as unknown as Queue,
});

describe('reverse proxy cache scheduling (success)', () => {
  it('queues cache warm request and serves cached content on subsequent request', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(
        new Response('upstream-body', {
          status: 200,
          headers: { 'set-cookie': 'a=b' },
        }),
      ),
    );
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const env = createEnv(queueSend);
    const encodedTarget = `/?url=${encodeURIComponent('https://example.com/data')}`;

    const scheduled = await app.request(encodedTarget, undefined, env);
    expect(scheduled.status).toBe(202);
    expect(queueSend).toHaveBeenCalledWith(
      { target: 'https://example.com/data' },
      { delaySeconds: 1 },
    );

    await processCacheWarmMessage({ target: 'https://example.com/data' }, { enableLogging: false });

    const cachedResponse = await app.request(encodedTarget, undefined, env);
    expect(cachedResponse.status).toBe(200);
    expect(await cachedResponse.text()).toBe('upstream-body');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('reverse proxy cache scheduling (retry)', () => {
  it('retries via queue when upstream responds with error', async () => {
    const { fetchSpy } = setupEnvironment(() =>
      Promise.resolve(new Response('fail', { status: 502 })),
    );
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const env = createEnv(queueSend);

    const encodedTarget = `/?url=${encodeURIComponent('https://example.com/data')}`;
    const firstAttempt = await app.request(encodedTarget, undefined, env);
    expect(firstAttempt.status).toBe(202);
    expect(queueSend).toHaveBeenCalledWith(
      { target: 'https://example.com/data' },
      { delaySeconds: 1 },
    );

    await processCacheWarmMessage({ target: 'https://example.com/data' }, { enableLogging: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const secondAttempt = await app.request(encodedTarget, undefined, env);
    expect(secondAttempt.status).toBe(202);
    expect(queueSend).toHaveBeenCalledTimes(2);
  });
});

describe('reverse proxy cache scheduling (delete)', () => {
  it('returns 404 when deleting without cached entry', async () => {
    setupEnvironment(() => Promise.resolve(new Response('cached', { status: 200 })));
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const env = createEnv(queueSend);

    const deleteResponse = await app.request(
      `/?url=${encodeURIComponent('https://example.com/data')}`,
      { method: 'DELETE' },
      env,
    );
    expect(deleteResponse.status).toBe(404);
    const deleteJson = (await deleteResponse.json()) as { deleted: boolean; error: string };
    expect(deleteJson.deleted).toBe(false);
  });
});
