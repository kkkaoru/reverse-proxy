// Tests for sign-in users repository
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  createSignInUser,
  deleteSignInUser,
  findSignInUserByDomainAndUserId,
  findSignInUserById,
  listSignInUsers,
  listSignInUsersByDomain,
  updateSignInUser,
} from '../../src/repositories/sign-in-users.ts';
import { createInMemoryD1Database, type InMemoryD1Row } from '../helpers.ts';

const TABLE_NAME = 'sign_in_users';

describe('findSignInUserByDomainAndUserId', () => {
  it('should return null when no user exists', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignInUserByDomainAndUserId(db, 'example.com', 'user@example.com');
    expect(result).toBeNull();
  });

  it('should return user when found by domain and userId', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'user-id-123',
      domain: 'example.com',
      user_id: 'user@example.com',
      password_hash: 'hashed-password-123',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignInUserByDomainAndUserId(db, 'example.com', 'user@example.com');

    expect(result).toStrictEqual({
      id: 'user-id-123',
      domain: 'example.com',
      userId: 'user@example.com',
      passwordHash: 'hashed-password-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('findSignInUserById', () => {
  it('should return null when no user exists for id', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignInUserById(db, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('should return user when found by id', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'user-id-456',
      domain: 'test.com',
      user_id: 'test@test.com',
      password_hash: 'test-hash',
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignInUserById(db, 'user-id-456');

    expect(result).toStrictEqual({
      id: 'user-id-456',
      domain: 'test.com',
      userId: 'test@test.com',
      passwordHash: 'test-hash',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
    });
  });
});

describe('listSignInUsers', () => {
  it('should return empty array when no users exist', async () => {
    const { db } = createInMemoryD1Database();
    const result = await listSignInUsers(db);
    expect(result).toStrictEqual([]);
  });

  it('should return all users', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'id-1',
      domain: 'site1.com',
      user_id: 'user1@site1.com',
      password_hash: 'hash1',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-2',
      domain: 'site2.com',
      user_id: 'user2@site2.com',
      password_hash: 'hash2',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });

    const result = await listSignInUsers(db);

    expect(result.length).toBe(2);
    expect(result[0]?.domain).toBe('site1.com');
    expect(result[1]?.domain).toBe('site2.com');
  });
});

describe('listSignInUsersByDomain', () => {
  it('should return empty array when no users for domain', async () => {
    const { db } = createInMemoryD1Database();
    const result = await listSignInUsersByDomain(db, 'example.com');
    expect(result).toStrictEqual([]);
  });

  it('should return users for specific domain', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'id-1',
      domain: 'target.com',
      user_id: 'user1@target.com',
      password_hash: 'hash1',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-2',
      domain: 'other.com',
      user_id: 'user@other.com',
      password_hash: 'hash2',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-3',
      domain: 'target.com',
      user_id: 'user2@target.com',
      password_hash: 'hash3',
      created_at: '2024-01-03T00:00:00.000Z',
      updated_at: '2024-01-03T00:00:00.000Z',
    });

    const result = await listSignInUsersByDomain(db, 'target.com');

    expect(result.length).toBe(2);
    expect(result[0]?.userId).toBe('user1@target.com');
    expect(result[1]?.userId).toBe('user2@target.com');
  });
});

describe('createSignInUser', () => {
  it('should create a new user and return it', async () => {
    const { db, getRows } = createInMemoryD1Database();

    const result = await createSignInUser(db, {
      domain: 'newsite.com',
      userId: 'newuser@newsite.com',
      passwordHash: 'new-hash',
    });

    expect(result.domain).toBe('newsite.com');
    expect(result.userId).toBe('newuser@newsite.com');
    expect(result.passwordHash).toBe('new-hash');
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();

    const rows = getRows(TABLE_NAME);
    expect(rows.length).toBe(1);
  });
});

describe('updateSignInUser', () => {
  it('should throw error when user not found', async () => {
    const { db } = createInMemoryD1Database();

    await expect(
      updateSignInUser(db, {
        id: 'non-existent-id',
        passwordHash: 'updated-hash',
      }),
    ).rejects.toThrow('Sign-in user not found');
  });

  it('should update user password hash', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'update-test-id',
      domain: 'updateme.com',
      user_id: 'user@updateme.com',
      password_hash: 'old-hash',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    const result = await updateSignInUser(db, {
      id: 'update-test-id',
      passwordHash: 'new-hash',
    });

    expect(result.passwordHash).toBe('new-hash');
  });
});

describe('deleteSignInUser', () => {
  it('should return false when user not found', async () => {
    const { db } = createInMemoryD1Database();
    const result = await deleteSignInUser(db, 'non-existent-id');
    expect(result).toBe(false);
  });

  it('should delete user and return true', async () => {
    const { db, insertRow, getRows } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'delete-me-id',
      domain: 'deleteme.com',
      user_id: 'delete@deleteme.com',
      password_hash: 'delete-hash',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    expect(getRows(TABLE_NAME).length).toBe(1);

    const result = await deleteSignInUser(db, 'delete-me-id');

    expect(result).toBe(true);
    expect(getRows(TABLE_NAME).length).toBe(0);
  });
});
