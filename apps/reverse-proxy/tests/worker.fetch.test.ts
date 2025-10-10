import { describe, expect, it, vi } from 'vitest';
import { fetch as workerFetch } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

interface QueueEnv {
  CACHE_WARM_QUEUE: Queue;
  LOG_REQUESTS?: string;
}

const createEnv = (queueSend: ReturnType<typeof vi.fn> = vi.fn()): QueueEnv => ({
  CACHE_WARM_QUEUE: {
    send: queueSend,
  } as unknown as Queue,
});

describe('worker fetch entrypoint', () => {
  it('delegates to proxy and enqueues cache warm message', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    const response = await workerFetch(request, createEnv(queueSend), undefined);
    expect(response.status).toBe(202);
    expect(queueSend).toHaveBeenCalledWith(
      { target: 'https://example.com/from-env' },
      { delaySeconds: 1 },
    );
  });

  it('activates logging when env requests', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const consoleSpy = vi.spyOn(console, 'log');
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    await workerFetch(request, { ...createEnv(), LOG_REQUESTS: 'TRUE' }, undefined);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
