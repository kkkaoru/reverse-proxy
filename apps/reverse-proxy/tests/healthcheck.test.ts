import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.ts';
import { HEALTHCHECK_PATH } from '../src/routes/healthcheck.ts';
import { setupEnvironment } from './helpers.ts';

describe('healthcheck', () => {
  it('returns 200 and logs event', async () => {
    setupEnvironment();
    const consoleSpy = vi.spyOn(console, 'log');
    const response = await app.request(HEALTHCHECK_PATH);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(consoleSpy).toHaveBeenCalledWith('[reverse-proxy]', 'healthcheck', expect.any(Object));
  });
});
