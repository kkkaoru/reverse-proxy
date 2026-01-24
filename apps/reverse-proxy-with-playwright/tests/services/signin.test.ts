// Tests for signin service
// Execute with bun: bunx vitest run

import type { Browser } from '@cloudflare/playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the browser launcher before importing the module
vi.mock('../../src/services/browser-launcher.ts', () => ({
  launchBrowser: vi.fn(),
}));

import { launchBrowser } from '../../src/services/browser-launcher.ts';
import {
  buildStorageStateKeyForTest,
  executeSignInFlow,
  fetchPageWithSignIn,
} from '../../src/services/signin.ts';
import { createInMemoryD1Database, createMockKVNamespace, type InMemoryD1Row } from '../helpers.ts';

interface MockCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
}

interface MockStorageState {
  cookies: MockCookie[];
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
  cookies: [
    {
      name: 'session',
      value: 'abc123',
      domain: 'example.com',
      path: '/',
      expires: 1704067200,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ],
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

describe('buildStorageStateKeyForTest', () => {
  it('should build key with domain and userId', () => {
    const result = buildStorageStateKeyForTest('example.com', 'user@example.com');
    expect(result).toBe('storage-state::example.com::user@example.com');
  });

  it('should handle special characters in userId', () => {
    const result = buildStorageStateKeyForTest('example.com', 'user+alias@example.com');
    expect(result).toBe('storage-state::example.com::user+alias@example.com');
  });
});

describe('executeSignInFlow', () => {
  beforeEach(() => {
    vi.mocked(launchBrowser).mockReset();
  });

  it('should return error when selector not found', async () => {
    const { db } = createInMemoryD1Database();
    const kv = createMockKVNamespace();
    const page = createMockPage('<html></html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await executeSignInFlow({
      browserWorker: {} as never,
      db,
      kv,
      domain: 'nonexistent.com',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result).toStrictEqual({
      success: false,
      errorMessage: 'Sign-in selector not found',
    });
  });

  it('should execute sign-in and store storage state on success', async () => {
    const { db, insertRow } = createInMemoryD1Database();
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

    const kv = createMockKVNamespace();
    const page = createMockPage('<html>Dashboard</html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await executeSignInFlow({
      browserWorker: {} as never,
      db,
      kv,
      domain: 'example.com',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result).toStrictEqual({ success: true });
    expect(kv.put).toHaveBeenCalledWith(
      'storage-state::example.com::user@example.com',
      expect.any(String),
    );
  });

  it('should return error when sign-in fails', async () => {
    const { db, insertRow } = createInMemoryD1Database();
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

    const kv = createMockKVNamespace();
    const page = createMockPage('<html></html>');
    page.fill = vi.fn().mockRejectedValue(new Error('Element not found'));
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await executeSignInFlow({
      browserWorker: {} as never,
      db,
      kv,
      domain: 'example.com',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Element not found');
  });
});

describe('fetchPageWithSignIn', () => {
  beforeEach(() => {
    vi.mocked(launchBrowser).mockReset();
  });

  it('should fetch page and return html without validation config', async () => {
    const { db } = createInMemoryD1Database();
    const kv = createMockKVNamespace();
    const page = createMockPage('<html>Content</html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPageWithSignIn({
      browserWorker: {} as never,
      db,
      kv,
      url: 'https://example.com/page',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result.html).toBe('<html>Content</html>');
    expect(result.signedIn).toBe(false);
  });

  it('should return signedIn true when validation passes', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const validationRow: InMemoryD1Row = {
      id: 'val-1',
      domain: 'example.com',
      text_selector: '.greeting',
      is_signed_in_regex_pattern: '^Welcome',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('signed_in_validation_regex', validationRow);

    const kv = createMockKVNamespace();
    const mockElement = {
      textContent: vi.fn().mockResolvedValue('Welcome, User'),
    };
    const page = createMockPage('<html>Welcome</html>');
    page.$ = vi.fn().mockResolvedValue(mockElement);
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPageWithSignIn({
      browserWorker: {} as never,
      db,
      kv,
      url: 'https://example.com/dashboard',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result.html).toBe('<html>Welcome</html>');
    expect(result.signedIn).toBe(true);
  });

  it('should attempt sign-in when validation fails', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const validationRow: InMemoryD1Row = {
      id: 'val-1',
      domain: 'example.com',
      text_selector: '.greeting',
      is_signed_in_regex_pattern: '^Welcome',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('signed_in_validation_regex', validationRow);

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

    const kv = createMockKVNamespace();
    const page = createMockPage('<html>Login Page</html>');
    page.$ = vi.fn().mockResolvedValue(null);
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPageWithSignIn({
      browserWorker: {} as never,
      db,
      kv,
      url: 'https://example.com/dashboard',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result.signedIn).toBe(true);
  });

  it('should return error when sign-in flow fails', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const validationRow: InMemoryD1Row = {
      id: 'val-1',
      domain: 'example.com',
      text_selector: '.greeting',
      is_signed_in_regex_pattern: '^Welcome',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('signed_in_validation_regex', validationRow);

    const kv = createMockKVNamespace();
    const page = createMockPage('<html>Login Page</html>');
    page.$ = vi.fn().mockResolvedValue(null);
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPageWithSignIn({
      browserWorker: {} as never,
      db,
      kv,
      url: 'https://example.com/dashboard',
      userId: 'user@example.com',
      password: 'secret',
    });

    expect(result.signedIn).toBe(false);
    expect(result.errorMessage).toBe('Sign-in selector not found');
  });
});
