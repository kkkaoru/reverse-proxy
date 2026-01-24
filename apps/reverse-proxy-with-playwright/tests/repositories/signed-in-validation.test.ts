// Tests for signed-in validation repository
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  createSignedInValidation,
  deleteSignedInValidation,
  findSignedInValidationByDomain,
  findSignedInValidationById,
  listSignedInValidations,
  updateSignedInValidation,
} from '../../src/repositories/signed-in-validation.ts';
import { createInMemoryD1Database, type InMemoryD1Row } from '../helpers.ts';

const TABLE_NAME = 'signed_in_validation_regex';

describe('findSignedInValidationByDomain', () => {
  it('should return null when no validation exists for domain', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignedInValidationByDomain(db, 'example.com');
    expect(result).toBeNull();
  });

  it('should return validation when found by domain', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'val-id-123',
      domain: 'example.com',
      text_selector: '.user-name',
      is_signed_in_regex_pattern: '^Welcome,',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignedInValidationByDomain(db, 'example.com');

    expect(result).toStrictEqual({
      id: 'val-id-123',
      domain: 'example.com',
      textSelector: '.user-name',
      isSignedInRegexPattern: '^Welcome,',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('findSignedInValidationById', () => {
  it('should return null when no validation exists for id', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignedInValidationById(db, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('should return validation when found by id', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'val-id-456',
      domain: 'test.com',
      text_selector: '#login-status',
      is_signed_in_regex_pattern: 'Logged in',
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignedInValidationById(db, 'val-id-456');

    expect(result).toStrictEqual({
      id: 'val-id-456',
      domain: 'test.com',
      textSelector: '#login-status',
      isSignedInRegexPattern: 'Logged in',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
    });
  });
});

describe('listSignedInValidations', () => {
  it('should return empty array when no validations exist', async () => {
    const { db } = createInMemoryD1Database();
    const result = await listSignedInValidations(db);
    expect(result).toStrictEqual([]);
  });

  it('should return all validations', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'id-1',
      domain: 'site1.com',
      text_selector: '.status',
      is_signed_in_regex_pattern: 'Online',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-2',
      domain: 'site2.com',
      text_selector: '#user',
      is_signed_in_regex_pattern: '.*',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });

    const result = await listSignedInValidations(db);

    expect(result.length).toBe(2);
    expect(result[0]?.domain).toBe('site1.com');
    expect(result[1]?.domain).toBe('site2.com');
  });
});

describe('createSignedInValidation', () => {
  it('should create a new validation and return it', async () => {
    const { db, getRows } = createInMemoryD1Database();

    const result = await createSignedInValidation(db, {
      domain: 'newsite.com',
      textSelector: '.login-indicator',
      isSignedInRegexPattern: '^Signed in$',
    });

    expect(result.domain).toBe('newsite.com');
    expect(result.textSelector).toBe('.login-indicator');
    expect(result.isSignedInRegexPattern).toBe('^Signed in$');
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();

    const rows = getRows(TABLE_NAME);
    expect(rows.length).toBe(1);
  });
});

describe('updateSignedInValidation', () => {
  it('should throw error when validation not found', async () => {
    const { db } = createInMemoryD1Database();

    await expect(
      updateSignedInValidation(db, {
        id: 'non-existent-id',
        textSelector: '.updated',
      }),
    ).rejects.toThrow('Signed-in validation not found');
  });

  it('should update validation fields', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'update-test-id',
      domain: 'updateme.com',
      text_selector: '.old-selector',
      is_signed_in_regex_pattern: 'old',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    const result = await updateSignedInValidation(db, {
      id: 'update-test-id',
      textSelector: '.new-selector',
      isSignedInRegexPattern: 'new',
    });

    expect(result.textSelector).toBe('.new-selector');
    expect(result.isSignedInRegexPattern).toBe('new');
  });
});

describe('deleteSignedInValidation', () => {
  it('should return false when validation not found', async () => {
    const { db } = createInMemoryD1Database();
    const result = await deleteSignedInValidation(db, 'non-existent-id');
    expect(result).toBe(false);
  });

  it('should delete validation and return true', async () => {
    const { db, insertRow, getRows } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'delete-me-id',
      domain: 'deleteme.com',
      text_selector: '.delete',
      is_signed_in_regex_pattern: 'delete',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    expect(getRows(TABLE_NAME).length).toBe(1);

    const result = await deleteSignedInValidation(db, 'delete-me-id');

    expect(result).toBe(true);
    expect(getRows(TABLE_NAME).length).toBe(0);
  });
});
