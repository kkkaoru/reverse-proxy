// Sign-in selectors repository for D1 database operations using Drizzle ORM
// Execute with bun: wrangler dev

import type { D1Database } from '@cloudflare/workers-types';
import { desc, eq } from 'drizzle-orm';
import { generateUuid7 } from '../crypto/uuid7.ts';
import { createDrizzleClient } from '../db/client.ts';
import { signInSelectors } from '../db/schema.ts';
import type { SignInSelector } from '../types/index.ts';

interface CreateSignInSelectorParams {
  domain: string;
  signInUrl: string;
  userIdSelector: string;
  passwordSelector: string;
  signInButtonSelector: string;
}

interface UpdateSignInSelectorParams {
  id: string;
  signInUrl?: string;
  userIdSelector?: string;
  passwordSelector?: string;
  signInButtonSelector?: string;
}

const mapRowToEntity = (row: typeof signInSelectors.$inferSelect): SignInSelector => ({
  id: row.id,
  domain: row.domain,
  signInUrl: row.signInUrl,
  userIdSelector: row.userIdSelector,
  passwordSelector: row.passwordSelector,
  signInButtonSelector: row.signInButtonSelector,
  createdAt: row.createdAt ?? '',
  updatedAt: row.updatedAt ?? '',
});

export const findSignInSelectorByDomain = async (
  db: D1Database,
  domain: string,
): Promise<SignInSelector | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signInSelectors)
    .where(eq(signInSelectors.domain, domain))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const findSignInSelectorById = async (
  db: D1Database,
  id: string,
): Promise<SignInSelector | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signInSelectors)
    .where(eq(signInSelectors.id, id))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const listSignInSelectors = async (db: D1Database): Promise<readonly SignInSelector[]> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signInSelectors)
    .orderBy(desc(signInSelectors.createdAt));

  return results.map(mapRowToEntity);
};

export const createSignInSelector = async (
  db: D1Database,
  params: CreateSignInSelectorParams,
): Promise<SignInSelector> => {
  const drizzle = createDrizzleClient(db);
  const id: string = generateUuid7();
  const now: string = new Date().toISOString();

  await drizzle.insert(signInSelectors).values({
    id,
    domain: params.domain,
    signInUrl: params.signInUrl,
    userIdSelector: params.userIdSelector,
    passwordSelector: params.passwordSelector,
    signInButtonSelector: params.signInButtonSelector,
    createdAt: now,
    updatedAt: now,
  });

  const created = await findSignInSelectorById(db, id);
  if (!created) {
    throw new Error('Failed to create sign-in selector');
  }

  return created;
};

export const updateSignInSelector = async (
  db: D1Database,
  params: UpdateSignInSelectorParams,
): Promise<SignInSelector> => {
  const existing = await findSignInSelectorById(db, params.id);
  if (!existing) {
    throw new Error('Sign-in selector not found');
  }

  const drizzle = createDrizzleClient(db);
  const now: string = new Date().toISOString();

  await drizzle
    .update(signInSelectors)
    .set({
      signInUrl: params.signInUrl ?? existing.signInUrl,
      userIdSelector: params.userIdSelector ?? existing.userIdSelector,
      passwordSelector: params.passwordSelector ?? existing.passwordSelector,
      signInButtonSelector: params.signInButtonSelector ?? existing.signInButtonSelector,
      updatedAt: now,
    })
    .where(eq(signInSelectors.id, params.id));

  const updated = await findSignInSelectorById(db, params.id);
  if (!updated) {
    throw new Error('Failed to update sign-in selector');
  }

  return updated;
};

export const deleteSignInSelector = async (db: D1Database, id: string): Promise<boolean> => {
  const drizzle = createDrizzleClient(db);
  const result = await drizzle.delete(signInSelectors).where(eq(signInSelectors.id, id));

  return (result.meta?.changes ?? 0) > 0;
};
