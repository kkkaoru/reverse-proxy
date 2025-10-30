import { describe, expect, it, vi } from 'vitest';
import { fetch as workerFetch } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

interface WorkerEnv {
  LOG_REQUESTS?: string;
}

const createEnv = (): WorkerEnv => ({});

describe('worker fetch entrypoint', () => {
  it('delegates to proxy fetch handler', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    const response = await workerFetch(request, createEnv(), undefined);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('body');
  });

  it('activates logging when env requests', async () => {
    setupEnvironment(() => Promise.resolve(new Response('body', { status: 200 })));
    const consoleSpy = vi.spyOn(console, 'log');
    const request = new Request(
      `http://localhost/?url=${encodeURIComponent('https://example.com/from-env')}`,
    );
    await workerFetch(request, { ...createEnv(), LOG_REQUESTS: 'TRUE' }, undefined);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
