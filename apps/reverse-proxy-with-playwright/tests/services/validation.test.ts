// Tests for validation service
// Execute with bun: bunx vitest run

import { describe, expect, it, vi } from 'vitest';
import { checkSignedIn, validateSignedInState } from '../../src/services/validation.ts';

interface MockElement {
  textContent: ReturnType<typeof vi.fn>;
}

interface MockPage {
  $: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockContext {
  newPage: ReturnType<typeof vi.fn>;
}

const createMockElement = (textContent: string | null): MockElement => ({
  textContent: vi.fn().mockResolvedValue(textContent),
});

const createMockPage = (element: MockElement | null): MockPage => ({
  $: vi.fn().mockResolvedValue(element),
  goto: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

const createMockContext = (page: MockPage): MockContext => ({
  newPage: vi.fn().mockResolvedValue(page),
});

describe('validateSignedInState', () => {
  it('should return isSignedIn true when text matches pattern', async () => {
    const element = createMockElement('Welcome, John');
    const page = createMockPage(element);

    const result = await validateSignedInState({
      page: page as never,
      textSelector: '.user-greeting',
      isSignedInRegexPattern: '^Welcome,',
    });

    expect(result).toStrictEqual({
      isSignedIn: true,
      matchedText: 'Welcome, John',
    });
    expect(page.$).toHaveBeenCalledWith('.user-greeting');
  });

  it('should return isSignedIn false when element not found', async () => {
    const page = createMockPage(null);

    const result = await validateSignedInState({
      page: page as never,
      textSelector: '.user-greeting',
      isSignedInRegexPattern: '^Welcome,',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
  });

  it('should return isSignedIn false when text is null', async () => {
    const element = createMockElement(null);
    const page = createMockPage(element);

    const result = await validateSignedInState({
      page: page as never,
      textSelector: '.user-greeting',
      isSignedInRegexPattern: '^Welcome,',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
  });

  it('should return isSignedIn false when text does not match pattern', async () => {
    const element = createMockElement('Please sign in');
    const page = createMockPage(element);

    const result = await validateSignedInState({
      page: page as never,
      textSelector: '.user-greeting',
      isSignedInRegexPattern: '^Welcome,',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
  });

  it('should handle regex patterns correctly', async () => {
    const element = createMockElement('アカウント');
    const page = createMockPage(element);

    const result = await validateSignedInState({
      page: page as never,
      textSelector: 'a.Icon_Login span',
      isSignedInRegexPattern: '^アカウント$',
    });

    expect(result).toStrictEqual({
      isSignedIn: true,
      matchedText: 'アカウント',
    });
  });

  it('should return isSignedIn false when selector throws error', async () => {
    const page = {
      $: vi.fn().mockRejectedValue(new Error('Selector failed')),
    };

    const result = await validateSignedInState({
      page: page as never,
      textSelector: '.invalid-selector',
      isSignedInRegexPattern: '.*',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
  });
});

describe('checkSignedIn', () => {
  it('should navigate to url and validate signed-in state', async () => {
    const element = createMockElement('Welcome, User');
    const page = createMockPage(element);
    const context = createMockContext(page);

    const result = await checkSignedIn({
      context: context as never,
      url: 'https://example.com/dashboard',
      textSelector: '.greeting',
      isSignedInRegexPattern: '^Welcome',
    });

    expect(result).toStrictEqual({
      isSignedIn: true,
      matchedText: 'Welcome, User',
    });
    expect(context.newPage).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://example.com/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    expect(page.close).toHaveBeenCalled();
  });

  it('should return isSignedIn false when page navigation fails', async () => {
    const page = createMockPage(null);
    page.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));
    const context = createMockContext(page);

    const result = await checkSignedIn({
      context: context as never,
      url: 'https://example.com/dashboard',
      textSelector: '.greeting',
      isSignedInRegexPattern: '^Welcome',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
    expect(page.close).toHaveBeenCalled();
  });

  it('should close page even when validation returns false', async () => {
    const page = createMockPage(null);
    const context = createMockContext(page);

    const result = await checkSignedIn({
      context: context as never,
      url: 'https://example.com/dashboard',
      textSelector: '.greeting',
      isSignedInRegexPattern: '^Welcome',
    });

    expect(result).toStrictEqual({ isSignedIn: false });
    expect(page.close).toHaveBeenCalled();
  });
});
