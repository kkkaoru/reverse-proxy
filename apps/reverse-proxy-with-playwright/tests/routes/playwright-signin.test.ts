// Tests for playwright signin route
// Execute with bun: bunx vitest run

import type { Browser } from '@cloudflare/playwright';
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// Mock the browser launcher before importing modules that use it
vi.mock('../../src/services/browser-launcher.ts', () => ({
  launchBrowser: vi.fn(),
}));

import type { WorkerBindings } from '../../src/global.d.ts';
import {
  getQueryParamsForTest,
  playwrightSignInHandler,
} from '../../src/routes/playwright-signin.ts';
import { launchBrowser } from '../../src/services/browser-launcher.ts';
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

const createMockPage = (): MockPage => ({
  goto: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue('<html></html>'),
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

it('playwrightSignInHandler returns 400 when params are missing', async () => {
  const mockContext = {
    req: {
      query: vi.fn().mockReturnValue(undefined),
    },
    json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  const response = await playwrightSignInHandler(mockContext);
  expect(response.status).toBe(400);
});

it('playwrightSignInHandler returns 400 for invalid URL', async () => {
  const mockContext = {
    req: {
      query: vi.fn((key: string) => {
        if (key === 'url') return encodeURIComponent('not-a-valid-url');
        if (key === 'user_id') return encodeURIComponent('user@example.com');
        return undefined;
      }),
    },
    json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  const response = await playwrightSignInHandler(mockContext);
  expect(response.status).toBe(400);
});

it('playwrightSignInHandler returns 404 when sign-in user not found', async () => {
  const { db } = createInMemoryD1Database();

  const mockContext = {
    env: { DB: db },
    req: {
      query: vi.fn((key: string) => {
        if (key === 'url') return encodeURIComponent('https://example.com/page');
        if (key === 'user_id') return encodeURIComponent('user@example.com');
        return undefined;
      }),
    },
    json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  const response = await playwrightSignInHandler(mockContext);
  expect(response.status).toBe(404);
});

it('playwrightSignInHandler returns 500 when sign-in selector not found', async () => {
  const { db, insertRow } = createInMemoryD1Database();
  const kv = createMockKVNamespace();

  const userRow: InMemoryD1Row = {
    id: 'user-1',
    domain: 'example.com',
    user_id: 'user@example.com',
    password_hash: 'hash',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
  insertRow('sign_in_users', userRow);

  const page = createMockPage();
  const context = createMockContext(page);
  const browser = createMockBrowser(context);
  vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

  const mockContext = {
    env: {
      DB: db,
      KV: kv,
      BROWSER: browser as unknown as Browser,
    },
    req: {
      query: vi.fn((key: string) => {
        if (key === 'url') return encodeURIComponent('https://example.com/page');
        if (key === 'user_id') return encodeURIComponent('user@example.com');
        return undefined;
      }),
    },
    json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  const response = await playwrightSignInHandler(mockContext);
  expect(response.status).toBe(500);
});

it('playwrightSignInHandler returns success when sign-in completes', async () => {
  const { db, insertRow } = createInMemoryD1Database();
  const kv = createMockKVNamespace();

  const userRow: InMemoryD1Row = {
    id: 'user-1',
    domain: 'example.com',
    user_id: 'user@example.com',
    password_hash: 'hash',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
  insertRow('sign_in_users', userRow);

  const selectorRow: InMemoryD1Row = {
    id: 'sel-1',
    domain: 'example.com',
    sign_in_url: 'https://example.com/login',
    user_id_selector: '#email',
    password_selector: '#password',
    sign_in_button_selector: '#submit',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
  insertRow('sign_in_selectors', selectorRow);

  const page = createMockPage();
  const context = createMockContext(page);
  const browser = createMockBrowser(context);
  vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

  const mockContext = {
    env: {
      DB: db,
      KV: kv,
      BROWSER: browser as unknown as Browser,
    },
    req: {
      query: vi.fn((key: string) => {
        if (key === 'url') return encodeURIComponent('https://example.com/page');
        if (key === 'user_id') return encodeURIComponent('user@example.com');
        return undefined;
      }),
    },
    json: vi.fn((data, status) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  const response = await playwrightSignInHandler(mockContext);
  expect(response.status).toBe(200);

  const body = await response.json();
  expect(body).toStrictEqual({
    success: true,
    message: 'Sign-in completed successfully',
    domain: 'example.com',
    userId: 'user@example.com',
  });
});
