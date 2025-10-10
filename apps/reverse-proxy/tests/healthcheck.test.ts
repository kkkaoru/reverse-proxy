import { describe, expect, it, vi } from 'vitest';
import { HEALTHCHECK_PATH } from '../src/healthcheck.ts';
import { app } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

describe('healthcheck', () => {
  it('returns 200 and logs event', async () => {
    setupEnvironment();
    const consoleSpy = vi.spyOn(console, 'log');
    const response = await app.request(HEALTHCHECK_PATH, undefined, {
      CACHE_WARM_QUEUE: {
        send: vi.fn(),
      } as unknown as Queue,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(consoleSpy).toHaveBeenCalledWith('[reverse-proxy]', 'healthcheck', expect.any(Object));
  });
});
