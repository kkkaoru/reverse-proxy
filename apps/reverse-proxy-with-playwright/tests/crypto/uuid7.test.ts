// Tests for UUID7 generation utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { generateUuid7, isValidUuid7 } from '../../src/crypto/uuid7.ts';

const UUID7_FORMAT_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateUuid7', () => {
  it('should generate a valid UUID7 string', () => {
    const uuid: string = generateUuid7();
    expect(isValidUuid7(uuid)).toBe(true);
  });

  it('should generate UUID7 with correct format', () => {
    const uuid: string = generateUuid7();
    expect(uuid).toMatch(UUID7_FORMAT_REGEX);
  });

  it('should generate unique UUIDs', () => {
    const uuid1: string = generateUuid7();
    const uuid2: string = generateUuid7();
    expect(uuid1).not.toBe(uuid2);
  });

  it('should have version 7 in the correct position', () => {
    const uuid: string = generateUuid7();
    const parts: string[] = uuid.split('-');
    expect(parts[2]?.[0]).toBe('7');
  });

  it('should have correct variant bits', () => {
    const uuid: string = generateUuid7();
    const parts: string[] = uuid.split('-');
    const variantChar: string = parts[3]?.[0] ?? '';
    expect(['8', '9', 'a', 'b']).toContain(variantChar.toLowerCase());
  });
});

describe('isValidUuid7', () => {
  it('should return true for valid UUID7', () => {
    expect(isValidUuid7('01234567-89ab-7cde-8f01-234567890abc')).toBe(true);
  });

  it('should return false for UUID4 format', () => {
    expect(isValidUuid7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('should return false for invalid UUID string', () => {
    expect(isValidUuid7('invalid-uuid')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidUuid7('')).toBe(false);
  });

  it('should return false for UUID with wrong variant', () => {
    expect(isValidUuid7('01234567-89ab-7cde-0f01-234567890abc')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isValidUuid7('01234567-89AB-7CDE-8F01-234567890ABC')).toBe(true);
  });
});
