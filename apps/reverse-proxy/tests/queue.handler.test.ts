import { describe, expect, it, vi } from 'vitest';
import { queue } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

const TARGET_URL = 'https://example.com/from-queue';

const createMessage = (
  body: unknown,
  ack: ReturnType<typeof vi.fn> = vi.fn(),
  retry: ReturnType<typeof vi.fn> = vi.fn(),
): Message<unknown> => ({
  body,
  ack,
  retry,
  id: crypto.randomUUID(),
  timestamp: new Date(),
  attempts: 0,
});

describe('queue handler', () => {
  it('processes cache warm messages successfully', async () => {
    setupEnvironment(() => Promise.resolve(new Response('queued', { status: 200 })));

    const ack = vi.fn();
    const retry = vi.fn();
    const batch: MessageBatch<unknown> = {
      queue: 'reverse-proxy-cache-warm',
      messages: [createMessage({ target: TARGET_URL }, ack, retry)],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };

    await queue(
      batch,
      { CACHE_WARM_QUEUE: { send: vi.fn() } as unknown as Queue },
      {} as ExecutionContext,
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries when processing fails', async () => {
    setupEnvironment(() => Promise.reject(new Error('network error')));

    const ack = vi.fn();
    const retry = vi.fn();
    const batch: MessageBatch<unknown> = {
      queue: 'reverse-proxy-cache-warm',
      messages: [createMessage({ target: TARGET_URL }, ack, retry)],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };

    await queue(
      batch,
      { CACHE_WARM_QUEUE: { send: vi.fn() } as unknown as Queue },
      {} as ExecutionContext,
    );

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
