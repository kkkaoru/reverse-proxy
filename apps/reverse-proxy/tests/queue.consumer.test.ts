import { describe, expect, it, vi } from 'vitest';
import { processCacheWarmMessage } from '../src/middleware.ts';
import { setupEnvironment } from './helpers.ts';

const TARGET_URL = 'https://example.com/queued';

const readCachedResponse = async (url: string): Promise<Response | null> => {
  const key = `${url}::${new Date().toISOString().split('T')[0]}`;
  const cached = await caches.default.match(key);
  return cached ? cached.clone() : null;
};

describe('queue consumer', () => {
  it('fetches and stores response without set-cookie header', async () => {
    setupEnvironment(() =>
      Promise.resolve(
        new Response('queued-body', {
          status: 200,
          headers: {
            'set-cookie': 'secret=1',
          },
        }),
      ),
    );

    await processCacheWarmMessage({ target: TARGET_URL }, { enableLogging: false });
    const cached = await readCachedResponse(TARGET_URL);
    expect(cached).not.toBeNull();
    expect(cached?.headers.get('set-cookie')).toBeNull();
  });

  it('logs and ignores messages without targets', async () => {
    setupEnvironment();
    const consoleSpy = vi.spyOn(console, 'log');
    await processCacheWarmMessage({ target: '' }, { enableLogging: true });
    expect(consoleSpy).toHaveBeenCalledWith('[reverse-proxy]', 'invalid-url', { target: '' });
  });

  it('logs and ignores messages with invalid URLs', async () => {
    setupEnvironment();
    const consoleSpy = vi.spyOn(console, 'log');
    await processCacheWarmMessage({ target: '::::' }, { enableLogging: true });
    expect(consoleSpy).toHaveBeenCalledWith('[reverse-proxy]', 'invalid-url', { target: '::::' });
  });
});
