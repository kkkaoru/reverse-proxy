// Tests for password hashing utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/crypto/password.ts';

const HEX_HASH_REGEX: RegExp = /^[0-9a-f]{64}$/;

describe('hashPassword', () => {
  it('should generate a hash for a password', async () => {
    const hash: string = await hashPassword({
      password: 'testPassword123',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    });
    expect(hash).toMatch(HEX_HASH_REGEX);
  });

  it('should generate consistent hash for same inputs', async () => {
    const params = {
      password: 'testPassword123',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    };
    const hash1: string = await hashPassword(params);
    const hash2: string = await hashPassword(params);
    expect(hash1).toStrictEqual(hash2);
  });

  it('should generate different hash for different passwords', async () => {
    const hash1: string = await hashPassword({
      password: 'password1',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    });
    const hash2: string = await hashPassword({
      password: 'password2',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hash for different salts', async () => {
    const hash1: string = await hashPassword({
      password: 'testPassword123',
      salt: 'user1@example.com',
      pepper: 'secretPepper',
    });
    const hash2: string = await hashPassword({
      password: 'testPassword123',
      salt: 'user2@example.com',
      pepper: 'secretPepper',
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hash for different peppers', async () => {
    const hash1: string = await hashPassword({
      password: 'testPassword123',
      salt: 'user@example.com',
      pepper: 'pepper1',
    });
    const hash2: string = await hashPassword({
      password: 'testPassword123',
      salt: 'user@example.com',
      pepper: 'pepper2',
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('should return true for correct password', async () => {
    const params = {
      password: 'testPassword123',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    };
    const hash: string = await hashPassword(params);
    const result: boolean = await verifyPassword(params, hash);
    expect(result).toBe(true);
  });

  it('should return false for incorrect password', async () => {
    const hash: string = await hashPassword({
      password: 'correctPassword',
      salt: 'user@example.com',
      pepper: 'secretPepper',
    });
    const result: boolean = await verifyPassword(
      {
        password: 'wrongPassword',
        salt: 'user@example.com',
        pepper: 'secretPepper',
      },
      hash,
    );
    expect(result).toBe(false);
  });

  it('should return false for incorrect salt', async () => {
    const hash: string = await hashPassword({
      password: 'testPassword123',
      salt: 'correct@example.com',
      pepper: 'secretPepper',
    });
    const result: boolean = await verifyPassword(
      {
        password: 'testPassword123',
        salt: 'wrong@example.com',
        pepper: 'secretPepper',
      },
      hash,
    );
    expect(result).toBe(false);
  });
});
