import { describe, expect, it } from 'vitest';
import { app, type ReverseProxyBindings } from '../src/app.ts';
import { setupEnvironment } from './helpers.ts';

const DEFAULT_ENV: ReverseProxyBindings = { CACHE_VERSION: 'v1' };

describe('reverse proxy validation', () => {
  it('rejects requests without url query', async () => {
    setupEnvironment();
    const response: Response = await app.request('/', {}, DEFAULT_ENV);
    expect(response.status).toBe(400);
  });

  it('rejects invalid url query', async () => {
    setupEnvironment();
    const response: Response = await app.request('/?url=::::', {}, DEFAULT_ENV);
    expect(response.status).toBe(400);
  });
});
