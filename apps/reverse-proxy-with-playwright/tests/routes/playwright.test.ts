// Tests for playwright route
// Execute with bun: bunx vitest run

import type { Browser } from '@cloudflare/playwright';
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// Mock the browser launcher before importing modules that use it
vi.mock('../../src/services/browser-launcher.ts', () => ({
  launchBrowser: vi.fn(),
}));

import { getQueryParamsForTest, playwrightHandler } from '../../src/routes/playwright.ts';
import { launchBrowser } from '../../src/services/browser-launcher.ts';
import type { WorkerBindings } from '../../src/types/index.ts';
import { createInMemoryD1Database, createMockKVNamespace, type InMemoryD1Row } from '../helpers.ts';

interface MockStorageState {
  cookies: never[];
  origins: never[];
}

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockContext {
  newPage: ReturnType<typeof vi.fn>;
  storageState: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockBrowser {
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const createMockStorageState = (): MockStorageState => ({
  cookies: [],
  origins: [],
});

const createMockPage = (html: string): MockPage => ({
  goto: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue(html),
  fill: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  $: vi.fn().mockResolvedValue(null),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockContext = (page: MockPage): MockContext => ({
  newPage: vi.fn().mockResolvedValue(page),
  storageState: vi.fn().mockResolvedValue(createMockStorageState()),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockBrowser = (context: MockContext): MockBrowser => ({
  newContext: vi.fn().mockResolvedValue(context),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('getQueryParamsForTest', () => {
  it('should return null when url is missing', () => {
    const mockContext = {
      req: {
        query: vi.fn((key: string) => (key === 'user_id' ? 'user%40example.com' : undefined)),
      },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = getQueryParamsForTest(mockContext);
    expect(result).toBeNull();
  });

  it('should return null when user_id is missing', () => {
    const mockContext = {
      req: {
        query: vi.fn((key: string) => (key === 'url' ? 'https%3A%2F%2Fexample.com' : undefined)),
      },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = getQueryParamsForTest(mockContext);
    expect(result).toBeNull();
  });

  it('should decode and return params when both present', () => {
    const mockContext = {
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com/page');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
      },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = getQueryParamsForTest(mockContext);
    expect(result).toStrictEqual({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
  });
});

describe('playwrightHandler - parameter validation', () => {
  it('should return 400 when params are missing', async () => {
    const kv = createMockKVNamespace();
    const mockContext = {
      env: { KV: kv },
      req: { query: vi.fn().mockReturnValue(undefined) },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const response = await playwrightHandler(mockContext);
    expect(response.status).toBe(400);
  });

  it('should return 400 for invalid URL', async () => {
    const kv = createMockKVNamespace();
    const mockContext = {
      env: { KV: kv },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('not-a-valid-url');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
      },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const response = await playwrightHandler(mockContext);
    expect(response.status).toBe(400);
  });

  it('should return 404 when sign-in user not found', async () => {
    const { db } = createInMemoryD1Database();
    const kv = createMockKVNamespace();
    const mockContext = {
      env: { DB: db, KV: kv },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com/page');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
      },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const response = await playwrightHandler(mockContext);
    expect(response.status).toBe(404);
  });
});

describe('playwrightHandler - caching', () => {
  it('should return cached html when available in KV', async () => {
    const kv = createMockKVNamespace();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));

    const cacheKey = 'html::https://example.com/page::user@example.com::2024-01-15';
    await kv.put(
      cacheKey,
      JSON.stringify({ html: '<html>Cached</html>', cachedAt: '2024-01-15T09:00:00.000Z' }),
    );

    const mockContext = {
      env: { KV: kv },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com/page');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
      },
      html: vi.fn((html, status) => new Response(html, { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const response = await playwrightHandler(mockContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>Cached</html>');
    vi.useRealTimers();
  });

  it('should fetch page when user exists and cache in KV', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const kv = createMockKVNamespace();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));

    const userRow: InMemoryD1Row = {
      id: 'user-1',
      domain: 'example.com',
      user_id: 'user@example.com',
      password_hash: 'hash',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('sign_in_users', userRow);

    const page = createMockPage('<html>Fresh content</html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const mockContext = {
      env: { DB: db, KV: kv, BROWSER: browser as unknown as Browser, PEPPER: 'test-pepper' },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com/page');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
      },
      html: vi.fn((html, status) => new Response(html, { status })),
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const response = await playwrightHandler(mockContext);
    expect(response.status).toBe(200);

    const cacheKey = 'html::https://example.com/page::user@example.com::2024-01-15';
    const cached = await kv.get(cacheKey);
    expect(cached).not.toBeNull();
    if (cached === null) throw new Error('cached should not be null');
    const cachedData = JSON.parse(cached) as { html: string; cachedAt: string };
    expect(cachedData.html).toBe('<html>Fresh content</html>');
    vi.useRealTimers();
  });
});
