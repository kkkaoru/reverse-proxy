import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

interface QueueEnv {
  CACHE_WARM_QUEUE: Queue;
}

const createEnv = (queueSend: ReturnType<typeof vi.fn>): QueueEnv => ({
  CACHE_WARM_QUEUE: {
    send: queueSend,
  } as unknown as Queue,
});

describe('reverse proxy validation', () => {
  it('rejects requests without url query', async () => {
    setupEnvironment();
    const queueSend = vi.fn();
    const response = await app.request('/', undefined, createEnv(queueSend));
    expect(response.status).toBe(400);
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('rejects invalid url query', async () => {
    setupEnvironment();
    const response = await app.request('/?url=::::', undefined, createEnv(vi.fn()));
    expect(response.status).toBe(400);
  });
});
