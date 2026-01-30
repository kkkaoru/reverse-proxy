// Secret keys repository for D1 database operations using Drizzle ORM
// Execute with bun: wrangler dev

import type { D1Database } from '@cloudflare/workers-types';
import { desc, eq } from 'drizzle-orm';
import { generateUuid7 } from '../crypto/uuid7.ts';
import { createDrizzleClient } from '../db/client.ts';
import { secretKeys } from '../db/schema.ts';
import type { SecretKey } from '../types/index.ts';

interface CreateSecretKeyParams {
  domain: string;
  secretKeyBase64: string;
}

interface UpdateSecretKeyParams {
  id: string;
  secretKeyBase64: string;
}

const mapRowToEntity = (row: typeof secretKeys.$inferSelect): SecretKey => ({
  id: row.id,
  domain: row.domain,
  secretKeyBase64: row.secretKeyBase64,
  createdAt: row.createdAt ?? '',
  updatedAt: row.updatedAt ?? '',
});

export const findSecretKeyByDomain = async (
  db: D1Database,
  domain: string,
): Promise<SecretKey | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(secretKeys)
    .where(eq(secretKeys.domain, domain))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const findSecretKeyById = async (db: D1Database, id: string): Promise<SecretKey | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle.select().from(secretKeys).where(eq(secretKeys.id, id)).limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const listSecretKeys = async (db: D1Database): Promise<readonly SecretKey[]> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle.select().from(secretKeys).orderBy(desc(secretKeys.createdAt));

  return results.map(mapRowToEntity);
};

export const createSecretKey = async (
  db: D1Database,
  params: CreateSecretKeyParams,
): Promise<SecretKey> => {
  const drizzle = createDrizzleClient(db);
  const id: string = generateUuid7();
  const now: string = new Date().toISOString();

  await drizzle.insert(secretKeys).values({
    id,
    domain: params.domain,
    secretKeyBase64: params.secretKeyBase64,
    createdAt: now,
    updatedAt: now,
  });

  const created = await findSecretKeyById(db, id);
  if (!created) {
    throw new Error('Failed to create secret key');
  }

  return created;
};

export const updateSecretKey = async (
  db: D1Database,
  params: UpdateSecretKeyParams,
): Promise<SecretKey> => {
  const existing = await findSecretKeyById(db, params.id);
  if (!existing) {
    throw new Error('Secret key not found');
  }

  const drizzle = createDrizzleClient(db);
  const now: string = new Date().toISOString();

  await drizzle
    .update(secretKeys)
    .set({
      secretKeyBase64: params.secretKeyBase64,
      updatedAt: now,
    })
    .where(eq(secretKeys.id, params.id));

  const updated = await findSecretKeyById(db, params.id);
  if (!updated) {
    throw new Error('Failed to update secret key');
  }

  return updated;
};

export const deleteSecretKey = async (db: D1Database, id: string): Promise<boolean> => {
  const drizzle = createDrizzleClient(db);
  const result = await drizzle.delete(secretKeys).where(eq(secretKeys.id, id));

  return (result.meta?.changes ?? 0) > 0;
};
