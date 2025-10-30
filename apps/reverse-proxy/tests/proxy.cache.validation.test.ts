import { describe, expect, it } from 'vitest';
import { app } from '../src/index.ts';
import { setupEnvironment } from './helpers.ts';

describe('reverse proxy validation', () => {
  it('rejects requests without url query', async () => {
    setupEnvironment();
    const response = await app.request('/');
    expect(response.status).toBe(400);
  });

  it('rejects invalid url query', async () => {
    setupEnvironment();
    const response = await app.request('/?url=::::');
    expect(response.status).toBe(400);
  });
});
