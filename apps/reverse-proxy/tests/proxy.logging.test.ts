import { describe, expect, it, vi } from 'vitest';
import { createApp, type ReverseProxyBindings } from '../src/app.ts';
import { setupEnvironment } from './helpers.ts';

const DEFAULT_ENV: ReverseProxyBindings = { CACHE_VERSION: 'v1' };

describe('reverse proxy logging', () => {
  it('emits log entries when logging-enabled app handles request', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const loggingApp = createApp({ enableLogging: true });
    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();

    const encodedTarget: string = `/?url=${encodeURIComponent('https://example.com/logging')}`;
    const response: Response = await loggingApp.request(encodedTarget, {}, DEFAULT_ENV);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('body');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('suppresses log output when logging disabled', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const silentApp = createApp({ enableLogging: false });
    const consoleSpy = vi.spyOn(console, 'log');
    consoleSpy.mockClear();
    await silentApp.request(
      `/?url=${encodeURIComponent('https://example.com/logging')}`,
      {},
      DEFAULT_ENV,
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
