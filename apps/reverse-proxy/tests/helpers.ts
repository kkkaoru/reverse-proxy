import { type MockInstance, vi } from 'vitest';

const createCacheKey = (input: RequestInfo | URL): string => {
  if (input instanceof Request) {
    return input.url;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input;
};

export const createMemoryCache = (): Cache => {
  const store = new Map<string, Response>();

  const match = (
    request: RequestInfo,
    _options?: CacheQueryOptions,
  ): Promise<Response | undefined> => {
    const key = createCacheKey(request);
    const cached = store.get(key);
    return Promise.resolve(cached ? cached.clone() : undefined);
  };

  const matchAll = (): Promise<readonly Response[]> => Promise.resolve([]);

  const put = (request: RequestInfo, response: Response): Promise<void> => {
    store.set(createCacheKey(request), response.clone());
    return Promise.resolve();
  };

  const remove = (request: RequestInfo, _options?: CacheQueryOptions): Promise<boolean> => {
    const key = createCacheKey(request);
    return Promise.resolve(store.delete(key));
  };

  const keys = (): Promise<readonly Request[]> => Promise.resolve([]);

  const add = (): Promise<void> => Promise.reject(new Error('add not implemented in test cache'));

  const addAll = (): Promise<void> =>
    Promise.reject(new Error('addAll not implemented in test cache'));

  return {
    match,
    matchAll,
    put,
    delete: remove,
    add,
    addAll,
    keys,
  } satisfies Cache;
};

export const createCacheStorage = (cache: Cache): CacheStorage => {
  type MatchFn = CacheStorage['match'];
  type HasFn = CacheStorage['has'];
  type OpenFn = CacheStorage['open'];
  type DeleteFn = CacheStorage['delete'];
  type KeysFn = CacheStorage['keys'];

  const match: MatchFn = (request: Parameters<MatchFn>[0], options: Parameters<MatchFn>[1]) =>
    cache.match(request, options);
  const has: HasFn = () => Promise.resolve(false);
  const open: OpenFn = () => Promise.resolve(cache);
  const remove: DeleteFn = () => Promise.resolve(false);
  const keys: KeysFn = () => Promise.resolve([]);

  return {
    default: cache,
    match,
    has,
    open,
    delete: remove,
    keys,
  } satisfies CacheStorage;
};

export type FetchImplementation = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const defaultFetchImplementation: FetchImplementation = () =>
  Promise.resolve(new Response('proxied', { status: 200 }));

export const setupEnvironment = (
  fetchImpl?: FetchImplementation,
): {
  fetchSpy: MockInstance<typeof fetch>;
} => {
  const cache = createMemoryCache();
  globalThis.caches = createCacheStorage(cache);
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockImplementation(fetchImpl ?? defaultFetchImplementation);
  return { fetchSpy };
};
