// Tests for secret keys repository
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  createSecretKey,
  deleteSecretKey,
  findSecretKeyByDomain,
  findSecretKeyById,
  listSecretKeys,
  updateSecretKey,
} from '../../src/repositories/secret-keys.ts';
import { createInMemoryD1Database, type InMemoryD1Row } from '../helpers.ts';

const TABLE_NAME = 'secret_keys';

describe('findSecretKeyByDomain', () => {
  it('should return null when no key exists for domain', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSecretKeyByDomain(db, 'example.com');
    expect(result).toBeNull();
  });

  it('should return key when found by domain', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'key-id-123',
      domain: 'example.com',
      secret_key_base64: 'c2VjcmV0LWtleS1iYXNlNjQ=',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSecretKeyByDomain(db, 'example.com');

    expect(result).toStrictEqual({
      id: 'key-id-123',
      domain: 'example.com',
      secretKeyBase64: 'c2VjcmV0LWtleS1iYXNlNjQ=',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('findSecretKeyById', () => {
  it('should return null when no key exists for id', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSecretKeyById(db, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('should return key when found by id', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'key-id-456',
      domain: 'test.com',
      secret_key_base64: 'dGVzdC1rZXk=',
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSecretKeyById(db, 'key-id-456');

    expect(result).toStrictEqual({
      id: 'key-id-456',
      domain: 'test.com',
      secretKeyBase64: 'dGVzdC1rZXk=',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
    });
  });
});

describe('listSecretKeys', () => {
  it('should return empty array when no keys exist', async () => {
    const { db } = createInMemoryD1Database();
    const result = await listSecretKeys(db);
    expect(result).toStrictEqual([]);
  });

  it('should return all keys', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'id-1',
      domain: 'site1.com',
      secret_key_base64: 'a2V5MQ==',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-2',
      domain: 'site2.com',
      secret_key_base64: 'a2V5Mg==',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });

    const result = await listSecretKeys(db);

    expect(result.length).toBe(2);
    expect(result[0]?.domain).toBe('site1.com');
    expect(result[1]?.domain).toBe('site2.com');
  });
});

describe('createSecretKey', () => {
  it('should create a new key and return it', async () => {
    const { db, getRows } = createInMemoryD1Database();

    const result = await createSecretKey(db, {
      domain: 'newsite.com',
      secretKeyBase64: 'bmV3LWtleQ==',
    });

    expect(result.domain).toBe('newsite.com');
    expect(result.secretKeyBase64).toBe('bmV3LWtleQ==');
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();

    const rows = getRows(TABLE_NAME);
    expect(rows.length).toBe(1);
  });
});

describe('updateSecretKey', () => {
  it('should throw error when key not found', async () => {
    const { db } = createInMemoryD1Database();

    await expect(
      updateSecretKey(db, {
        id: 'non-existent-id',
        secretKeyBase64: 'dXBkYXRlZA==',
      }),
    ).rejects.toThrow('Secret key not found');
  });

  it('should update key fields', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'update-test-id',
      domain: 'updateme.com',
      secret_key_base64: 'b2xkLWtleQ==',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    const result = await updateSecretKey(db, {
      id: 'update-test-id',
      secretKeyBase64: 'bmV3LWtleQ==',
    });

    expect(result.secretKeyBase64).toBe('bmV3LWtleQ==');
  });
});

describe('deleteSecretKey', () => {
  it('should return false when key not found', async () => {
    const { db } = createInMemoryD1Database();
    const result = await deleteSecretKey(db, 'non-existent-id');
    expect(result).toBe(false);
  });

  it('should delete key and return true', async () => {
    const { db, insertRow, getRows } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'delete-me-id',
      domain: 'deleteme.com',
      secret_key_base64: 'ZGVsZXRlLW1l',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    expect(getRows(TABLE_NAME).length).toBe(1);

    const result = await deleteSecretKey(db, 'delete-me-id');

    expect(result).toBe(true);
    expect(getRows(TABLE_NAME).length).toBe(0);
  });
});
