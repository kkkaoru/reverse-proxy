// Signed-in validation repository for D1 database operations using Drizzle ORM
// Execute with bun: wrangler dev

import type { D1Database } from '@cloudflare/workers-types';
import { desc, eq } from 'drizzle-orm';
import { generateUuid7 } from '../crypto/uuid7.ts';
import { createDrizzleClient } from '../db/client.ts';
import { signedInValidationRegex } from '../db/schema.ts';
import type { SignedInValidationRegex } from '../types.ts';

interface CreateSignedInValidationParams {
  domain: string;
  textSelector: string;
  isSignedInRegexPattern: string;
}

interface UpdateSignedInValidationParams {
  id: string;
  textSelector?: string;
  isSignedInRegexPattern?: string;
}

const mapRowToEntity = (
  row: typeof signedInValidationRegex.$inferSelect,
): SignedInValidationRegex => ({
  id: row.id,
  domain: row.domain,
  textSelector: row.textSelector,
  isSignedInRegexPattern: row.isSignedInRegexPattern,
  createdAt: row.createdAt ?? '',
  updatedAt: row.updatedAt ?? '',
});

export const findSignedInValidationByDomain = async (
  db: D1Database,
  domain: string,
): Promise<SignedInValidationRegex | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signedInValidationRegex)
    .where(eq(signedInValidationRegex.domain, domain))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const findSignedInValidationById = async (
  db: D1Database,
  id: string,
): Promise<SignedInValidationRegex | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signedInValidationRegex)
    .where(eq(signedInValidationRegex.id, id))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const listSignedInValidations = async (
  db: D1Database,
): Promise<readonly SignedInValidationRegex[]> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signedInValidationRegex)
    .orderBy(desc(signedInValidationRegex.createdAt));

  return results.map(mapRowToEntity);
};

export const createSignedInValidation = async (
  db: D1Database,
  params: CreateSignedInValidationParams,
): Promise<SignedInValidationRegex> => {
  const drizzle = createDrizzleClient(db);
  const id: string = generateUuid7();
  const now: string = new Date().toISOString();

  await drizzle.insert(signedInValidationRegex).values({
    id,
    domain: params.domain,
    textSelector: params.textSelector,
    isSignedInRegexPattern: params.isSignedInRegexPattern,
    createdAt: now,
    updatedAt: now,
  });

  const created = await findSignedInValidationById(db, id);
  if (!created) {
    throw new Error('Failed to create signed-in validation');
  }

  return created;
};

export const updateSignedInValidation = async (
  db: D1Database,
  params: UpdateSignedInValidationParams,
): Promise<SignedInValidationRegex> => {
  const existing = await findSignedInValidationById(db, params.id);
  if (!existing) {
    throw new Error('Signed-in validation not found');
  }

  const drizzle = createDrizzleClient(db);
  const now: string = new Date().toISOString();

  await drizzle
    .update(signedInValidationRegex)
    .set({
      textSelector: params.textSelector ?? existing.textSelector,
      isSignedInRegexPattern: params.isSignedInRegexPattern ?? existing.isSignedInRegexPattern,
      updatedAt: now,
    })
    .where(eq(signedInValidationRegex.id, params.id));

  const updated = await findSignedInValidationById(db, params.id);
  if (!updated) {
    throw new Error('Failed to update signed-in validation');
  }

  return updated;
};

export const deleteSignedInValidation = async (db: D1Database, id: string): Promise<boolean> => {
  const drizzle = createDrizzleClient(db);
  const result = await drizzle
    .delete(signedInValidationRegex)
    .where(eq(signedInValidationRegex.id, id));

  return (result.meta?.changes ?? 0) > 0;
};
