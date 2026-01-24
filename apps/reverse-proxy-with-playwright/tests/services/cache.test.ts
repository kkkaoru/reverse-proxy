// Tests for cache service
// Execute with bun: bunx vitest run

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCacheKeyForTest,
  deleteCachedHtml,
  formatDateKeyForTest,
  getCachedHtml,
  setCachedHtml,
} from '../../src/services/cache.ts';
import { createCacheStorage, createMemoryCache } from '../helpers.ts';

describe('formatDateKeyForTest', () => {
  it('should format date as yyyy-mm-dd', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    const result = formatDateKeyForTest(date);
    expect(result).toBe('2024-01-15');
  });

  it('should pad single digit month with zero', () => {
    const date = new Date('2024-03-05T00:00:00.000Z');
    const result = formatDateKeyForTest(date);
    expect(result).toBe('2024-03-05');
  });

  it('should handle december correctly', () => {
    const date = new Date('2024-12-31T23:59:59.000Z');
    const result = formatDateKeyForTest(date);
    expect(result).toBe('2024-12-31');
  });
});

describe('buildCacheKeyForTest', () => {
  it('should build cache key with all parameters', () => {
    const result = buildCacheKeyForTest(
      {
        url: 'https://example.com/page',
        userId: 'user@example.com',
      },
      '2024-01-15',
    );
    expect(result).toBe('html::https://example.com/page::user@example.com::2024-01-15');
  });

  it('should handle special characters in url', () => {
    const result = buildCacheKeyForTest(
      {
        url: 'https://example.com/page?id=123&name=test',
        userId: 'user@example.com',
      },
      '2024-01-15',
    );
    expect(result).toBe(
      'html::https://example.com/page?id=123&name=test::user@example.com::2024-01-15',
    );
  });

  it('should handle special characters in userId', () => {
    const result = buildCacheKeyForTest(
      {
        url: 'https://example.com/page',
        userId: 'user+alias@example.com',
      },
      '2024-01-15',
    );
    expect(result).toBe('html::https://example.com/page::user+alias@example.com::2024-01-15');
  });
});

describe('getCachedHtml', () => {
  beforeEach(() => {
    const cache = createMemoryCache();
    globalThis.caches = createCacheStorage(cache);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when no cached data exists', async () => {
    const result = await getCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
    expect(result).toBeNull();
  });

  it('should return cached data when it exists', async () => {
    const cache = await caches.open('html-cache');
    const cacheKey = 'html::https://example.com/page::user@example.com::2024-01-15';
    const cacheUrl = `https://cache.internal/${encodeURIComponent(cacheKey)}`;

    const cacheData = {
      html: '<html><body>Cached content</body></html>',
      cachedAt: '2024-01-15T09:00:00.000Z',
    };

    await cache.put(cacheUrl, Response.json(cacheData));

    const result = await getCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });

    expect(result).toStrictEqual({
      html: '<html><body>Cached content</body></html>',
      cachedAt: '2024-01-15T09:00:00.000Z',
    });
  });
});

describe('setCachedHtml', () => {
  beforeEach(() => {
    const cache = createMemoryCache();
    globalThis.caches = createCacheStorage(cache);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store html in cache', async () => {
    await setCachedHtml(
      {
        url: 'https://example.com/page',
        userId: 'user@example.com',
      },
      '<html><body>New content</body></html>',
    );

    const cache = await caches.open('html-cache');
    const cacheKey = 'html::https://example.com/page::user@example.com::2024-01-15';
    const cacheUrl = `https://cache.internal/${encodeURIComponent(cacheKey)}`;

    const cached = await cache.match(cacheUrl);
    expect(cached).not.toBeUndefined();

    const data = (await cached?.json()) as { html: string; cachedAt: string };
    expect(data.html).toBe('<html><body>New content</body></html>');
    expect(data.cachedAt).toBe('2024-01-15T10:00:00.000Z');
  });

  it('should overwrite existing cache', async () => {
    await setCachedHtml(
      {
        url: 'https://example.com/page',
        userId: 'user@example.com',
      },
      '<html><body>First content</body></html>',
    );

    await setCachedHtml(
      {
        url: 'https://example.com/page',
        userId: 'user@example.com',
      },
      '<html><body>Second content</body></html>',
    );

    const result = await getCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });

    expect(result?.html).toBe('<html><body>Second content</body></html>');
  });
});

describe('deleteCachedHtml', () => {
  beforeEach(() => {
    const cache = createMemoryCache();
    globalThis.caches = createCacheStorage(cache);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false when no cached data exists', async () => {
    const result = await deleteCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
    expect(result).toBe(false);
  });

  it('should delete cached data and return true', async () => {
    await setCachedHtml(
      {
        url: 'https://example.com/page',
        userId: 'user@example.com',
      },
      '<html><body>Content to delete</body></html>',
    );

    const beforeDelete = await getCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
    expect(beforeDelete).not.toBeNull();

    const result = await deleteCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
    expect(result).toBe(true);

    const afterDelete = await getCachedHtml({
      url: 'https://example.com/page',
      userId: 'user@example.com',
    });
    expect(afterDelete).toBeNull();
  });
});
