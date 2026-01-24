// Tests for browser service
// Execute with bun: bunx vitest run

import type { Browser } from '@cloudflare/playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the browser launcher before importing the module
vi.mock('../../src/services/browser-launcher.ts', () => ({
  launchBrowser: vi.fn(),
}));

import {
  deserializeStorageState,
  fetchPage,
  performSignIn,
  serializeStorageState,
} from '../../src/services/browser.ts';
import { launchBrowser } from '../../src/services/browser-launcher.ts';

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

interface MockLocalStorageItem {
  name: string;
  value: string;
}

interface MockOrigin {
  origin: string;
  localStorage: MockLocalStorageItem[];
}

interface MockStorageState {
  cookies: MockCookie[];
  origins: MockOrigin[];
}

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
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
  origins: [
    {
      origin: 'https://example.com',
      localStorage: [{ name: 'token', value: 'xyz789' }],
    },
  ],
});

const createMockPage = (html: string): MockPage => ({
  goto: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue(html),
  fill: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
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

describe('fetchPage', () => {
  beforeEach(() => {
    vi.mocked(launchBrowser).mockReset();
  });

  it('should fetch page content without storage state', async () => {
    const page = createMockPage('<html><body>Test content</body></html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPage({
      browserWorker: {} as never,
      url: 'https://example.com/page',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.html).toBe('<html><body>Test content</body></html>');
      expect(result.storageState).toStrictEqual(createMockStorageState());
    }
    expect(browser.newContext).toHaveBeenCalledWith({});
    expect(page.goto).toHaveBeenCalledWith('https://example.com/page', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('should fetch page content with storage state', async () => {
    const page = createMockPage('<html><body>Logged in content</body></html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    const existingStorageState = createMockStorageState();
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await fetchPage({
      browserWorker: {} as never,
      url: 'https://example.com/dashboard',
      storageState: existingStorageState,
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.html).toBe('<html><body>Logged in content</body></html>');
    }
    expect(browser.newContext).toHaveBeenCalledWith({
      storageState: existingStorageState,
    });
  });

  it('should return error when launch throws', async () => {
    vi.mocked(launchBrowser).mockRejectedValue(new Error('Browser not available'));

    const result = await fetchPage({
      browserWorker: {} as never,
      url: 'https://example.com/page',
    });

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.errorMessage).toBe('Browser not available');
    }
  });
});

describe('performSignIn', () => {
  beforeEach(() => {
    vi.mocked(launchBrowser).mockReset();
  });

  it('should perform sign-in successfully', async () => {
    const page = createMockPage('<html><body>Dashboard</body></html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await performSignIn({
      browserWorker: {} as never,
      signInUrl: 'https://example.com/login',
      userIdSelector: '#email',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
      userId: 'user@example.com',
      password: 'secret123',
    });

    expect(result.success).toBe(true);
    expect(result.storageState).toStrictEqual(createMockStorageState());
    expect(result.errorMessage).toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    expect(page.fill).toHaveBeenCalledWith('#email', 'user@example.com');
    expect(page.fill).toHaveBeenCalledWith('#password', 'secret123');
    expect(page.click).toHaveBeenCalledWith('#submit');
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', {
      timeout: 60000,
    });
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('should perform sign-in with existing storage state', async () => {
    const page = createMockPage('<html><body>Dashboard</body></html>');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    const existingStorageState = createMockStorageState();
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    await performSignIn({
      browserWorker: {} as never,
      signInUrl: 'https://example.com/login',
      userIdSelector: '#email',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
      userId: 'user@example.com',
      password: 'secret123',
      storageState: existingStorageState,
    });

    expect(browser.newContext).toHaveBeenCalledWith({
      storageState: existingStorageState,
    });
  });

  it('should handle sign-in failure', async () => {
    const page = createMockPage('');
    page.fill = vi.fn().mockRejectedValue(new Error('Element not found'));
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await performSignIn({
      browserWorker: {} as never,
      signInUrl: 'https://example.com/login',
      userIdSelector: '#email',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
      userId: 'user@example.com',
      password: 'secret123',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Element not found');
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  it('should handle unknown error during sign-in', async () => {
    const page = createMockPage('');
    page.click = vi.fn().mockRejectedValue('Unknown error string');
    const context = createMockContext(page);
    const browser = createMockBrowser(context);
    vi.mocked(launchBrowser).mockResolvedValue(browser as unknown as Browser);

    const result = await performSignIn({
      browserWorker: {} as never,
      signInUrl: 'https://example.com/login',
      userIdSelector: '#email',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
      userId: 'user@example.com',
      password: 'secret123',
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Unknown error during sign-in');
    expect(browser.close).toHaveBeenCalled();
  });
});

describe('serializeStorageState', () => {
  it('should serialize storage state to JSON string', () => {
    const state = createMockStorageState();
    const result = serializeStorageState(state);
    expect(result).toBe(JSON.stringify(state));
  });

  it('should handle empty storage state', () => {
    const state = { cookies: [], origins: [] };
    const result = serializeStorageState(state);
    expect(result).toBe('{"cookies":[],"origins":[]}');
  });
});

describe('deserializeStorageState', () => {
  it('should deserialize JSON string to storage state', () => {
    const state = createMockStorageState();
    const json = JSON.stringify(state);
    const result = deserializeStorageState(json);
    expect(result).toStrictEqual(state);
  });

  it('should handle empty storage state', () => {
    const json = '{"cookies":[],"origins":[]}';
    const result = deserializeStorageState(json);
    expect(result).toStrictEqual({ cookies: [], origins: [] });
  });
});
