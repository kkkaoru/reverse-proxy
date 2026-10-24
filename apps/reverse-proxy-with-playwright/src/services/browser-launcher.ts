// Browser launcher wrapper for testability
// Execute with bun: wrangler dev

import {
  acquire,
  type Browser,
  type BrowserWorker,
  connect,
  sessions,
} from '@cloudflare/playwright';

// Idle sessions are billed, so keep them only long enough to catch the next
// request during peak traffic (10s is the Browser Run minimum).
export const BROWSER_SESSION_KEEP_ALIVE_MS = 10_000;

interface LaunchBrowserOptions {
  // Skip reuse, e.g. on a retry after the previous session failed.
  fresh?: boolean;
}

const connectFirst = async (
  browserWorker: BrowserWorker,
  sessionIds: string[],
): Promise<Browser | null> => {
  const [sessionId, ...rest] = sessionIds;
  if (sessionId === undefined) {
    return null;
  }
  try {
    return await connect(browserWorker, sessionId);
  } catch {
    // Another request took it or it just expired: try the next one.
    return connectFirst(browserWorker, rest);
  }
};

const connectToIdleSession = async (browserWorker: BrowserWorker): Promise<Browser | null> => {
  const idle = (await sessions(browserWorker)).filter((session) => !session.connectionId);
  return connectFirst(
    browserWorker,
    idle.map((session) => session.sessionId),
  );
};

// Browsers are always obtained via connect(), so browser.close() only
// disconnects and the session stays warm for keep_alive. Callers must create
// a new context per request: cookies and storage are context-scoped, which is
// what keeps state from leaking between requests on a shared session.
export const launchBrowser = async (
  browserWorker: BrowserWorker,
  options: LaunchBrowserOptions = {},
): Promise<Browser> => {
  const reused = options.fresh ? null : await connectToIdleSession(browserWorker).catch(() => null);
  if (reused) {
    return reused;
  }
  const { sessionId } = await acquire(browserWorker, {
    keep_alive: BROWSER_SESSION_KEEP_ALIVE_MS,
  });
  return connect(browserWorker, sessionId);
};
