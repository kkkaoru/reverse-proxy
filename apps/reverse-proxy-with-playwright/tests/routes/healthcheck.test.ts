// Tests for healthcheck route handler
// Execute with bun: bunx vitest run

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleHealthcheck } from '../../src/routes/healthcheck.ts';
import { createMockContext } from '../helpers.ts';

const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe('handleHealthcheck', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should return 200 status', () => {
    const ctx = createMockContext({ path: '/healthcheck' });
    const response: Response = handleHealthcheck(ctx);
    expect(response.status).toBe(200);
  });

  it('should return JSON response with ok status', () => {
    const ctx = createMockContext({ path: '/healthcheck' });
    handleHealthcheck(ctx);
    expect(ctx.json).toHaveBeenCalled();
    const callArgs = vi.mocked(ctx.json).mock.calls[0];
    expect(callArgs?.[0]).toMatchObject({
      status: 'ok',
      service: 'reverse-proxy-with-playwright',
    });
  });

  it('should include timestamp in response', () => {
    const ctx = createMockContext({ path: '/healthcheck' });
    handleHealthcheck(ctx);
    const callArgs = vi.mocked(ctx.json).mock.calls[0];
    const responseBody = callArgs?.[0] as { timestamp: string };
    expect(responseBody.timestamp).toMatch(TIMESTAMP_REGEX);
  });

  it('should log healthcheck request', () => {
    const ctx = createMockContext({ path: '/healthcheck' });
    handleHealthcheck(ctx);
    expect(console.log).toHaveBeenCalled();
  });

  it('should work with admin healthcheck path', () => {
    const ctx = createMockContext({ path: '/admin/healthcheck' });
    const response: Response = handleHealthcheck(ctx);
    expect(response.status).toBe(200);
  });

  it('should work with playwright healthcheck path', () => {
    const ctx = createMockContext({ path: '/playwright/healthcheck' });
    const response: Response = handleHealthcheck(ctx);
    expect(response.status).toBe(200);
  });
});
