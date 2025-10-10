import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

const TARGET_URL = 'https://example.com/logging';
const ENCODED_TARGET = `/?url=${encodeURIComponent(TARGET_URL)}`;

describe('reverse proxy logging', () => {
  it('emits log entries and schedules queue when logging-enabled app handles request', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const loggingApp = createApp({ enableLogging: true, queueBinding: 'CACHE_WARM_QUEUE' });
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log');
    const queueEnv = {
      CACHE_WARM_QUEUE: {
        send: queueSend,
      } as unknown as Queue,
    };

    const scheduled = await loggingApp.request(ENCODED_TARGET, undefined, queueEnv);
    expect(scheduled.status).toBe(202);
    expect(queueSend).toHaveBeenCalledWith({ target: TARGET_URL }, { delaySeconds: 1 });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('suppresses log output when logging disabled', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const silentApp = createApp({ enableLogging: false });
    const consoleSpy = vi.spyOn(console, 'log');
    await silentApp.request(ENCODED_TARGET);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
