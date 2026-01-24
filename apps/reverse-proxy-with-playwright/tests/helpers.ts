// Test helpers for reverse-proxy-with-playwright
// Execute with bun: bunx vitest run

import type { Context } from 'hono';
import { vi } from 'vitest';
import type { WorkerBindings } from '../src/global.d.ts';

// SQL parsing regex patterns - support both quoted and unquoted column/table names
// Also support table-prefixed column names like "table"."column"
const FROM_REGEX = /FROM\s+["`]?(\w+)["`]?/i;
const INTO_REGEX = /INTO\s+["`]?(\w+)["`]?/i;
const UPDATE_REGEX = /UPDATE\s+["`]?(\w+)["`]?/i;
const DELETE_FROM_REGEX = /DELETE\s+FROM\s+["`]?(\w+)["`]?/i;
const WHERE_REGEX = /WHERE\s+(?:["`]?\w+["`]?\.)?\s*["`]?(\w+)["`]?\s*=\s*\?/i;
const WHERE_AND_REGEX =
  /WHERE\s+(?:["`]?\w+["`]?\.)?\s*["`]?(\w+)["`]?\s*=\s*\?\s+AND\s+(?:["`]?\w+["`]?\.)?\s*["`]?(\w+)["`]?\s*=\s*\?/i;
const INSERT_REGEX = /INSERT/i;
const UPDATE_KEYWORD_REGEX = /UPDATE/i;
const DELETE_KEYWORD_REGEX = /DELETE/i;
const COLUMNS_REGEX = /\(([^)]+)\)\s*(?:values|VALUES)/i;
const SET_REGEX = /SET\s+([\s\S]+?)\s+WHERE/i;
const COL_MATCH_REGEX = /["`]?(\w+)["`]?\s*=/;

interface PreparedStatement {
  bind: (...values: readonly unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[]; success: boolean }>;
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
  raw: <T = unknown>() => Promise<T[]>;
}

const extractTableName = (query: string): string => {
  const fromMatch = query.match(FROM_REGEX);
  if (fromMatch) return fromMatch[1] ?? '';
  const intoMatch = query.match(INTO_REGEX);
  if (intoMatch) return intoMatch[1] ?? '';
  const updateMatch = query.match(UPDATE_REGEX);
  if (updateMatch) return updateMatch[1] ?? '';
  const deleteMatch = query.match(DELETE_FROM_REGEX);
  if (deleteMatch) return deleteMatch[1] ?? '';
  return '';
};

export interface MockContextOptions {
  path?: string;
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export const createMockContext = (
  options: MockContextOptions = {},
): Context<{ Bindings: WorkerBindings }> => {
  const path: string = options.path ?? '/';
  const method: string = options.method ?? 'GET';
  const query: Record<string, string> = options.query ?? {};
  const headers: Record<string, string> = options.headers ?? {};

  const url: URL = new URL(`http://localhost${path}`);
  Object.entries(query).map(([key, value]: [string, string]) => url.searchParams.set(key, value));

  const request: Request = new Request(url.toString(), {
    method,
    headers: new Headers(headers),
  });

  const jsonResponses: unknown[] = [];
  const htmlResponses: string[] = [];

  const mockContext = {
    req: {
      url: url.toString(),
      path,
      method,
      query: vi.fn((key: string) => query[key]),
      header: vi.fn((key: string) => headers[key]),
      raw: request,
    },
    json: vi.fn(<T>(data: T, status?: number) => {
      jsonResponses.push(data);
      return new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
    html: vi.fn((html: string, status?: number) => {
      htmlResponses.push(html);
      return new Response(html, {
        status: status ?? 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }),
    text: vi.fn(
      (text: string, status?: number) =>
        new Response(text, {
          status: status ?? 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    ),
    env: {} as WorkerBindings,
  } as unknown as Context<{ Bindings: WorkerBindings }>;

  return mockContext;
};

export const createMemoryCache = (): Cache => {
  const store: Map<string, Response> = new Map();

  const createCacheKey = (input: RequestInfo | URL): string => {
    if (input instanceof Request) {
      return input.url;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    return input;
  };

  const match = (request: RequestInfo): Promise<Response | undefined> => {
    const key: string = createCacheKey(request);
    const cached: Response | undefined = store.get(key);
    return Promise.resolve(cached ? cached.clone() : undefined);
  };

  const matchAll = (): Promise<readonly Response[]> => Promise.resolve([]);

  const put = (request: RequestInfo, response: Response): Promise<void> => {
    store.set(createCacheKey(request), response.clone());
    return Promise.resolve();
  };

  const remove = (request: RequestInfo): Promise<boolean> => {
    const key: string = createCacheKey(request);
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

export interface MockD1Result<T> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1MockData {
  first?: unknown;
  all?: { results: readonly unknown[] };
  runChanges?: number;
}

export const createMockD1Database = (mockData?: D1MockData): D1Database => {
  const defaultFirst = mockData?.first ?? null;
  const defaultAll = mockData?.all ?? { results: [], success: true, meta: {} };
  const defaultRunChanges = mockData?.runChanges ?? 1;

  const mockPreparedStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(defaultFirst),
    all: vi.fn().mockResolvedValue({
      ...defaultAll,
      success: true,
      meta: {},
    }),
    run: vi.fn().mockResolvedValue({
      success: true,
      meta: { changes: defaultRunChanges },
    }),
    raw: vi.fn().mockResolvedValue([]),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockPreparedStatement),
    exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    batch: vi.fn().mockResolvedValue([]),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database;
};

export interface InMemoryD1Row {
  [key: string]: unknown;
}

export const createInMemoryD1Database = (): {
  db: D1Database;
  insertRow: (table: string, row: InMemoryD1Row) => void;
  getRows: (table: string) => readonly InMemoryD1Row[];
  clearTable: (table: string) => void;
} => {
  const tables: Map<string, InMemoryD1Row[]> = new Map();

  const insertRow = (table: string, row: InMemoryD1Row): void => {
    const rows = tables.get(table) ?? [];
    rows.push({ ...row });
    tables.set(table, rows);
  };

  const getRows = (table: string): readonly InMemoryD1Row[] => tables.get(table) ?? [];

  const clearTable = (table: string): void => {
    tables.set(table, []);
  };

  const createPreparedStatement = (sql: string): PreparedStatement => {
    const boundValues: unknown[] = [];

    const bind = (...values: readonly unknown[]): PreparedStatement => {
      boundValues.push(...values);
      return preparedStatement;
    };

    const first = <T>(): Promise<T | null> => {
      const tableName = extractTableName(sql);
      const rows = tables.get(tableName) ?? [];

      // Check for compound WHERE with AND
      const whereAndMatch = sql.match(WHERE_AND_REGEX);
      if (whereAndMatch && boundValues.length >= 2) {
        const column1 = whereAndMatch[1] ?? '';
        const column2 = whereAndMatch[2] ?? '';
        const value1 = boundValues[0];
        const value2 = boundValues[1];
        const found = rows.find((row) => row[column1] === value1 && row[column2] === value2);
        return Promise.resolve((found as T) ?? null);
      }

      // Check for simple WHERE
      const whereMatch = sql.match(WHERE_REGEX);
      if (whereMatch && boundValues.length > 0) {
        const column = whereMatch[1] ?? '';
        const value = boundValues[0];
        const found = rows.find((row) => row[column] === value);
        return Promise.resolve((found as T) ?? null);
      }

      return Promise.resolve((rows[0] as T) ?? null);
    };

    const all = <T>(): Promise<{ results: T[]; success: boolean }> => {
      const tableName = extractTableName(sql);
      const rows = tables.get(tableName) ?? [];

      // Check for compound WHERE with AND
      const whereAndMatch = sql.match(WHERE_AND_REGEX);
      if (whereAndMatch && boundValues.length >= 2) {
        const column1 = whereAndMatch[1] ?? '';
        const column2 = whereAndMatch[2] ?? '';
        const value1 = boundValues[0];
        const value2 = boundValues[1];
        const filtered = rows.filter((row) => row[column1] === value1 && row[column2] === value2);
        return Promise.resolve({ results: filtered as T[], success: true });
      }

      // Check for simple WHERE
      const whereMatch = sql.match(WHERE_REGEX);
      if (whereMatch && boundValues.length > 0) {
        const column = whereMatch[1] ?? '';
        const value = boundValues[0];
        const filtered = rows.filter((row) => row[column] === value);
        return Promise.resolve({ results: filtered as T[], success: true });
      }

      return Promise.resolve({ results: rows as T[], success: true });
    };

    const handleInsert = (tableName: string): { success: boolean; meta: { changes: number } } => {
      const columnsMatch = sql.match(COLUMNS_REGEX);
      if (columnsMatch) {
        const columns = (columnsMatch[1] ?? '')
          .split(',')
          .map((c) => c.trim().replace(/^["`]|["`]$/g, ''));
        const newRow: InMemoryD1Row = {};
        columns.map((col, idx) => {
          newRow[col] = boundValues[idx];
          return newRow;
        });
        insertRow(tableName, newRow);
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    };

    const applySetPairs = (targetRow: InMemoryD1Row, setMatch: RegExpMatchArray): void => {
      const setPairs = (setMatch[1] ?? '').split(',');
      setPairs.map((pair, idx) => {
        const colMatch = pair.trim().match(COL_MATCH_REGEX);
        const colName = (colMatch?.[1] ?? '').replace(/^["`]|["`]$/g, '');
        if (colName) targetRow[colName] = boundValues[idx];
        return pair;
      });
    };

    const handleUpdate = (tableName: string): { success: boolean; meta: { changes: number } } => {
      const noChanges = { success: true, meta: { changes: 0 } };
      const rows = tables.get(tableName) ?? [];
      const whereMatch = sql.match(WHERE_REGEX);
      if (!whereMatch) return noChanges;

      const column = whereMatch[1] ?? '';
      const whereValue = boundValues[boundValues.length - 1];
      const targetRow = rows.find((row) => row[column] === whereValue);
      if (!targetRow) return noChanges;

      const setMatch = sql.match(SET_REGEX);
      if (!setMatch) return noChanges;

      applySetPairs(targetRow, setMatch);
      return { success: true, meta: { changes: 1 } };
    };

    const handleDelete = (tableName: string): { success: boolean; meta: { changes: number } } => {
      const rows = tables.get(tableName) ?? [];
      const whereMatch = sql.match(WHERE_REGEX);
      if (!whereMatch) return { success: true, meta: { changes: 0 } };

      const column = whereMatch[1] ?? '';
      const value = boundValues[0];
      const initialLength = rows.length;
      const filtered = rows.filter((row) => row[column] !== value);
      tables.set(tableName, filtered);
      return { success: true, meta: { changes: initialLength - filtered.length } };
    };

    const executeOperation = (
      tableName: string,
    ): { success: boolean; meta: { changes: number } } => {
      const isInsert = INSERT_REGEX.test(sql);
      const isUpdate = UPDATE_KEYWORD_REGEX.test(sql);
      const isDelete = DELETE_KEYWORD_REGEX.test(sql);

      if (isInsert) return handleInsert(tableName);
      if (isUpdate) return handleUpdate(tableName);
      if (isDelete) return handleDelete(tableName);
      return { success: true, meta: { changes: 0 } };
    };

    const run = (): Promise<{ success: boolean; meta: { changes: number } }> =>
      Promise.resolve(executeOperation(extractTableName(sql)));

    const raw = <T = unknown>(): Promise<T[]> => {
      const tableName = extractTableName(sql);
      const rows = tables.get(tableName) ?? [];

      // Check for compound WHERE with AND
      const whereAndMatch = sql.match(WHERE_AND_REGEX);
      if (whereAndMatch && boundValues.length >= 2) {
        const column1 = whereAndMatch[1] ?? '';
        const column2 = whereAndMatch[2] ?? '';
        const value1 = boundValues[0];
        const value2 = boundValues[1];
        const filtered = rows.filter((row) => row[column1] === value1 && row[column2] === value2);
        // Return as array of arrays (raw format) - each row is an array of column values
        const result = filtered.map((row) => Object.values(row));
        return Promise.resolve(result as T[]);
      }

      // Check for simple WHERE
      const whereMatch = sql.match(WHERE_REGEX);
      if (whereMatch && boundValues.length > 0) {
        const column = whereMatch[1] ?? '';
        const value = boundValues[0];
        const filtered = rows.filter((row) => row[column] === value);
        const result = filtered.map((row) => Object.values(row));
        return Promise.resolve(result as T[]);
      }

      // No WHERE clause - return all rows
      const result = rows.map((row) => Object.values(row));
      return Promise.resolve(result as T[]);
    };

    const preparedStatement: PreparedStatement = {
      bind,
      first,
      all,
      run,
      raw,
    };

    return preparedStatement;
  };

  const db = {
    prepare: (sql: string): PreparedStatement => createPreparedStatement(sql),
    exec: (): Promise<{ count: number; duration: number }> =>
      Promise.resolve({ count: 0, duration: 0 }),
    batch: (): Promise<never[]> => Promise.resolve([]),
    dump: (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as D1Database;

  return { db, insertRow, getRows, clearTable };
};

export const createMockKVNamespace = (): KVNamespace => {
  const store: Map<string, string> = new Map();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
};

export const setupTestEnvironment = (): void => {
  const cache: Cache = createMemoryCache();
  globalThis.caches = createCacheStorage(cache);
};
