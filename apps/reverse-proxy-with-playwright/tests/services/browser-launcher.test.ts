// Tests for browser session reuse
// Execute with bun: bunx vitest run

import type { Browser, BrowserWorker } from '@cloudflare/playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cloudflare/playwright', () => ({
  acquire: vi.fn(),
  connect: vi.fn(),
  sessions: vi.fn(),
}));

import { acquire, connect, sessions } from '@cloudflare/playwright';
import {
  BROWSER_SESSION_KEEP_ALIVE_MS,
  launchBrowser,
} from '../../src/services/browser-launcher.ts';

const worker = {} as BrowserWorker;
const browser = { id: 'browser' } as unknown as Browser;

describe('launchBrowser', () => {
  beforeEach(() => {
    vi.mocked(acquire).mockReset().mockResolvedValue({ sessionId: 'new' });
    vi.mocked(connect).mockReset().mockResolvedValue(browser);
    vi.mocked(sessions).mockReset().mockResolvedValue([]);
  });

  it('connects to an idle session and skips ones that already have a connection', async () => {
    vi.mocked(sessions).mockResolvedValue([
      { sessionId: 'busy', startTime: 1, connectionId: 'c1' },
      { sessionId: 'idle', startTime: 2 },
    ]);

    await expect(launchBrowser(worker)).resolves.toBe(browser);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(worker, 'idle');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('tries the next idle session when connect fails', async () => {
    vi.mocked(sessions).mockResolvedValue([
      { sessionId: 'taken', startTime: 1 },
      { sessionId: 'idle', startTime: 2 },
    ]);
    vi.mocked(connect).mockRejectedValueOnce(new Error('already connected'));

    await expect(launchBrowser(worker)).resolves.toBe(browser);

    expect(connect).toHaveBeenNthCalledWith(1, worker, 'taken');
    expect(connect).toHaveBeenNthCalledWith(2, worker, 'idle');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('acquires a new keep-alive session when no idle session can be connected', async () => {
    vi.mocked(sessions).mockResolvedValue([{ sessionId: 'gone', startTime: 1 }]);
    vi.mocked(connect).mockRejectedValueOnce(new Error('session closed'));

    await expect(launchBrowser(worker)).resolves.toBe(browser);

    expect(acquire).toHaveBeenCalledWith(worker, { keep_alive: BROWSER_SESSION_KEEP_ALIVE_MS });
    expect(connect).toHaveBeenLastCalledWith(worker, 'new');
  });

  it('falls back to a new session when listing sessions fails', async () => {
    vi.mocked(sessions).mockRejectedValue(new Error('sessions unavailable'));

    await expect(launchBrowser(worker)).resolves.toBe(browser);

    expect(connect).toHaveBeenCalledWith(worker, 'new');
  });

  it('never reuses a session when fresh is requested', async () => {
    vi.mocked(sessions).mockResolvedValue([{ sessionId: 'idle', startTime: 1 }]);

    await launchBrowser(worker, { fresh: true });

    expect(sessions).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(worker, 'new');
  });

  it('propagates acquire failures', async () => {
    vi.mocked(acquire).mockRejectedValue(new Error('rate limited'));

    await expect(launchBrowser(worker)).rejects.toThrow('rate limited');
  });
});
