import { describe, expect, it, vi } from 'vitest';
import { fetch as workerFetch } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

describe('worker fetch logging', () => {
  it('activates logging when LOG_REQUESTS env is set', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const consoleSpy = vi.spyOn(console, 'log');
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    const response = await workerFetch(request, { LOG_REQUESTS: 'TRUE' }, undefined);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('body');
    expect(consoleSpy).toHaveBeenCalled();
  });
});
