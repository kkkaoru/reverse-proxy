// Tests for auth middleware
// Execute with bun: bunx vitest run

import type { Context, Next } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { signEd25519Message } from '../../src/crypto/ed25519.ts';
import {
  authMiddleware,
  buildSignatureMessageForTest,
  extractBearerTokenForTest,
  verifyBearerToken,
} from '../../src/middleware/auth.ts';
import type { WorkerBindings } from '../../src/types/index.ts';
import { createInMemoryD1Database, type InMemoryD1Row } from '../helpers.ts';

// Test key from README - OpenSSH ED25519 private key base64
const TEST_SECRET_KEY_BASE64 =
  'LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUFNd0FBQUF0emMyZ3RaVwpReU5UVXhPUUFBQUNBVnlwakd1ZEkrT1hrdENaZG8vc2lMWkwxZXBYOGx6eUJ0MEMzSEFMOWJaUUFBQUpCUHVKcUFUN2lhCmdBQUFBQXR6YzJndFpXUXlOVFV4T1FBQUFDQVZ5cGpHdWRJK09Ya3RDWmRvL3NpTFpMMWVwWDhsenlCdDBDM0hBTDliWlEKQUFBRUNvb3hzYUpVMzdyMWFRcU5JZ2daTXlMTlY1VWdmalErcVU3aU5zTkIxVkhSWEttTWE1MGo0NWVTMEpsMmoreUl0awp2VjZsZnlYUElHM1FMY2NBdjF0bEFBQUFEWEpsZG1WeWMyVXRjSEp2ZUhrPQotLS0tLUVORCBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0K';

describe('extractBearerTokenForTest', () => {
  it('should return null when header is undefined', () => {
    const result = extractBearerTokenForTest(undefined);
    expect(result).toBeNull();
  });

  it('should return null when header format is invalid', () => {
    const result = extractBearerTokenForTest('InvalidFormat');
    expect(result).toBeNull();
  });

  it('should return null when not using Bearer scheme', () => {
    const result = extractBearerTokenForTest('Basic abc123');
    expect(result).toBeNull();
  });

  it('should return token when valid Bearer format', () => {
    const result = extractBearerTokenForTest('Bearer abc123token');
    expect(result).toBe('abc123token');
  });

  it('should handle Bearer with special characters in token', () => {
    const result = extractBearerTokenForTest('Bearer abc+def/ghi==');
    expect(result).toBe('abc+def/ghi==');
  });
});

describe('buildSignatureMessageForTest', () => {
  it('should build message with url and userId', () => {
    const result = buildSignatureMessageForTest('https://example.com/page', 'user@example.com');
    expect(result).toBe('https://example.com/page::user@example.com');
  });

  it('should handle special characters', () => {
    const result = buildSignatureMessageForTest(
      'https://example.com/page?id=123',
      'user+alias@example.com',
    );
    expect(result).toBe('https://example.com/page?id=123::user+alias@example.com');
  });
});

describe('verifyBearerToken', () => {
  it('should return verified false when domain extraction fails', async () => {
    const { db } = createInMemoryD1Database();
    const mockContext = {
      env: { DB: db },
      req: { header: vi.fn().mockReturnValue(undefined) },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = await verifyBearerToken(mockContext, 'invalid-url', 'user@example.com');

    expect(result.verified).toBe(false);
  });

  it('should return verified false when secret key not found', async () => {
    const { db } = createInMemoryD1Database();
    const mockContext = {
      env: { DB: db },
      req: { header: vi.fn().mockReturnValue(undefined) },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = await verifyBearerToken(
      mockContext,
      'https://example.com/page',
      'user@example.com',
    );

    expect(result.verified).toBe(false);
    expect(result.domain).toBe('example.com');
  });

  it('should return verified false when no auth header', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const secretKeyRow: InMemoryD1Row = {
      id: 'key-1',
      domain: 'example.com',
      secret_key_base64: TEST_SECRET_KEY_BASE64,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('secret_keys', secretKeyRow);

    const mockContext = {
      env: { DB: db },
      req: { header: vi.fn().mockReturnValue(undefined) },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = await verifyBearerToken(
      mockContext,
      'https://example.com/page',
      'user@example.com',
    );

    expect(result.verified).toBe(false);
  });

  it('should return verified true with valid signature', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const secretKeyRow: InMemoryD1Row = {
      id: 'key-1',
      domain: 'example.com',
      secret_key_base64: TEST_SECRET_KEY_BASE64,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('secret_keys', secretKeyRow);

    const message = 'https://example.com/page::user@example.com';
    const signature = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);

    const mockContext = {
      env: { DB: db },
      req: { header: vi.fn().mockReturnValue(`Bearer ${signature}`) },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = await verifyBearerToken(
      mockContext,
      'https://example.com/page',
      'user@example.com',
    );

    expect(result.verified).toBe(true);
    expect(result.domain).toBe('example.com');
    expect(result.url).toBe('https://example.com/page');
    expect(result.userId).toBe('user@example.com');
  });

  it('should return verified false with invalid signature', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const secretKeyRow: InMemoryD1Row = {
      id: 'key-1',
      domain: 'example.com',
      secret_key_base64: TEST_SECRET_KEY_BASE64,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('secret_keys', secretKeyRow);

    const mockContext = {
      env: { DB: db },
      req: { header: vi.fn().mockReturnValue('Bearer invalid_signature') },
    } as unknown as Context<{ Bindings: WorkerBindings }>;

    const result = await verifyBearerToken(
      mockContext,
      'https://example.com/page',
      'user@example.com',
    );

    expect(result.verified).toBe(false);
  });
});

describe('authMiddleware', () => {
  it('should return 400 when url is missing', async () => {
    const { db } = createInMemoryD1Database();
    const mockContext = {
      env: { DB: db },
      req: {
        query: vi.fn((key: string) => (key === 'user_id' ? 'user' : undefined)),
      },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;
    const next: Next = vi.fn();

    const response = await authMiddleware(mockContext, next);

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(400);
  });

  it('should return 400 when user_id is missing', async () => {
    const { db } = createInMemoryD1Database();
    const mockContext = {
      env: { DB: db },
      req: {
        query: vi.fn((key: string) => (key === 'url' ? 'https://example.com' : undefined)),
      },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;
    const next: Next = vi.fn();

    const response = await authMiddleware(mockContext, next);

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(400);
  });

  it('should return 401 when verification fails', async () => {
    const { db } = createInMemoryD1Database();
    const mockContext = {
      env: { DB: db },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
        header: vi.fn().mockReturnValue(undefined),
      },
      json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context<{ Bindings: WorkerBindings }>;
    const next: Next = vi.fn();

    const response = await authMiddleware(mockContext, next);

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(401);
  });

  it('should call next when verification succeeds', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const secretKeyRow: InMemoryD1Row = {
      id: 'key-1',
      domain: 'example.com',
      secret_key_base64: TEST_SECRET_KEY_BASE64,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow('secret_keys', secretKeyRow);

    const message = 'https://example.com/page::user@example.com';
    const signature = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);

    const mockContext = {
      env: { DB: db },
      req: {
        query: vi.fn((key: string) => {
          if (key === 'url') return encodeURIComponent('https://example.com/page');
          if (key === 'user_id') return encodeURIComponent('user@example.com');
          return undefined;
        }),
        header: vi.fn().mockReturnValue(`Bearer ${signature}`),
      },
      set: vi.fn(),
    } as unknown as Context<{ Bindings: WorkerBindings }>;
    const next: Next = vi.fn().mockResolvedValue(undefined);

    const response = await authMiddleware(mockContext, next);

    expect(response).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
