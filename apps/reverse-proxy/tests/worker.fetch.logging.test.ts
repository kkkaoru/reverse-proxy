import { describe, expect, it, vi } from 'vitest';
import { fetch as workerFetch } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

describe('worker fetch logging', () => {
  it('activates logging when LOG_REQUESTS env is set', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const consoleSpy = vi.spyOn(console, 'log');
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    await workerFetch(
      request,
      { CACHE_WARM_QUEUE: { send: queueSend } as unknown as Queue, LOG_REQUESTS: 'TRUE' },
      undefined,
    );
    expect(consoleSpy).toHaveBeenCalled();
  });
});
