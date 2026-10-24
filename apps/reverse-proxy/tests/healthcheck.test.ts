import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.ts';
import { HEALTHCHECK_PATH } from '../src/routes/healthcheck.ts';
import { setupEnvironment } from './helpers.ts';

describe('healthcheck', () => {
  it('returns 200 without logging or touching bindings', async () => {
    setupEnvironment();
    const consoleSpy = vi.spyOn(console, 'log');
    const kvGet = vi.fn();
    const env = { WORKER_ID: 'queue-a', KV: { get: kvGet } };
    const response = await app.request(HEALTHCHECK_PATH, {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('X-Worker-Id')).toBe('queue-a');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(kvGet).not.toHaveBeenCalled();
  });
});
