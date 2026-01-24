// Tests for sign-in selectors repository
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  createSignInSelector,
  deleteSignInSelector,
  findSignInSelectorByDomain,
  findSignInSelectorById,
  listSignInSelectors,
  updateSignInSelector,
} from '../../src/repositories/sign-in-selectors.ts';
import type { InMemoryD1Row } from '../helpers.ts';
import { createInMemoryD1Database } from '../helpers.ts';

const TABLE_NAME = 'sign_in_selectors';

describe('findSignInSelectorByDomain', () => {
  it('should return null when no selector exists for domain', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignInSelectorByDomain(db, 'example.com');
    expect(result).toBeNull();
  });

  it('should return selector when found by domain', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'test-id-123',
      domain: 'example.com',
      sign_in_url: 'https://example.com/login',
      user_id_selector: '#username',
      password_selector: '#password',
      sign_in_button_selector: '#submit',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignInSelectorByDomain(db, 'example.com');

    expect(result).toStrictEqual({
      id: 'test-id-123',
      domain: 'example.com',
      signInUrl: 'https://example.com/login',
      userIdSelector: '#username',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('findSignInSelectorById', () => {
  it('should return null when no selector exists for id', async () => {
    const { db } = createInMemoryD1Database();
    const result = await findSignInSelectorById(db, 'non-existent-id');
    expect(result).toBeNull();
  });

  it('should return selector when found by id', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    const row: InMemoryD1Row = {
      id: 'test-id-456',
      domain: 'test.com',
      sign_in_url: 'https://test.com/auth',
      user_id_selector: 'input[name=email]',
      password_selector: 'input[name=pass]',
      sign_in_button_selector: 'button[type=submit]',
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    };
    insertRow(TABLE_NAME, row);

    const result = await findSignInSelectorById(db, 'test-id-456');

    expect(result).toStrictEqual({
      id: 'test-id-456',
      domain: 'test.com',
      signInUrl: 'https://test.com/auth',
      userIdSelector: 'input[name=email]',
      passwordSelector: 'input[name=pass]',
      signInButtonSelector: 'button[type=submit]',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
    });
  });
});

describe('listSignInSelectors', () => {
  it('should return empty array when no selectors exist', async () => {
    const { db } = createInMemoryD1Database();
    const result = await listSignInSelectors(db);
    expect(result).toStrictEqual([]);
  });

  it('should return all selectors', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'id-1',
      domain: 'site1.com',
      sign_in_url: 'https://site1.com/login',
      user_id_selector: '#user',
      password_selector: '#pass',
      sign_in_button_selector: '#btn',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });
    insertRow(TABLE_NAME, {
      id: 'id-2',
      domain: 'site2.com',
      sign_in_url: 'https://site2.com/login',
      user_id_selector: '#email',
      password_selector: '#pwd',
      sign_in_button_selector: '#login',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });

    const result = await listSignInSelectors(db);

    expect(result.length).toBe(2);
    expect(result[0]?.domain).toBe('site1.com');
    expect(result[1]?.domain).toBe('site2.com');
  });
});

describe('createSignInSelector', () => {
  it('should create a new selector and return it', async () => {
    const { db, getRows } = createInMemoryD1Database();

    const result = await createSignInSelector(db, {
      domain: 'newsite.com',
      signInUrl: 'https://newsite.com/signin',
      userIdSelector: '#email',
      passwordSelector: '#password',
      signInButtonSelector: '#submit',
    });

    expect(result.domain).toBe('newsite.com');
    expect(result.signInUrl).toBe('https://newsite.com/signin');
    expect(result.userIdSelector).toBe('#email');
    expect(result.passwordSelector).toBe('#password');
    expect(result.signInButtonSelector).toBe('#submit');
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();

    const rows = getRows(TABLE_NAME);
    expect(rows.length).toBe(1);
  });
});

describe('updateSignInSelector', () => {
  it('should throw error when selector not found', async () => {
    const { db } = createInMemoryD1Database();

    await expect(
      updateSignInSelector(db, {
        id: 'non-existent-id',
        signInUrl: 'https://updated.com/login',
      }),
    ).rejects.toThrow('Sign-in selector not found');
  });

  it('should update selector fields', async () => {
    const { db, insertRow } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'update-test-id',
      domain: 'updateme.com',
      sign_in_url: 'https://updateme.com/old',
      user_id_selector: '#old-user',
      password_selector: '#old-pass',
      sign_in_button_selector: '#old-btn',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    const result = await updateSignInSelector(db, {
      id: 'update-test-id',
      signInUrl: 'https://updateme.com/new',
      userIdSelector: '#new-user',
    });

    expect(result.signInUrl).toBe('https://updateme.com/new');
    expect(result.userIdSelector).toBe('#new-user');
  });
});

describe('deleteSignInSelector', () => {
  it('should return false when selector not found', async () => {
    const { db } = createInMemoryD1Database();
    const result = await deleteSignInSelector(db, 'non-existent-id');
    expect(result).toBe(false);
  });

  it('should delete selector and return true', async () => {
    const { db, insertRow, getRows } = createInMemoryD1Database();
    insertRow(TABLE_NAME, {
      id: 'delete-me-id',
      domain: 'deleteme.com',
      sign_in_url: 'https://deleteme.com/login',
      user_id_selector: '#user',
      password_selector: '#pass',
      sign_in_button_selector: '#btn',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    });

    expect(getRows(TABLE_NAME).length).toBe(1);

    const result = await deleteSignInSelector(db, 'delete-me-id');

    expect(result).toBe(true);
    expect(getRows(TABLE_NAME).length).toBe(0);
  });
});
