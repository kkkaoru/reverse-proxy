// Sign-in users repository for D1 database operations using Drizzle ORM
// Execute with bun: wrangler dev

import type { D1Database } from '@cloudflare/workers-types';
import { and, desc, eq } from 'drizzle-orm';
import { generateUuid7 } from '../crypto/uuid7.ts';
import { createDrizzleClient } from '../db/client.ts';
import { signInUsers } from '../db/schema.ts';
import type { SignInUser } from '../types.ts';

interface CreateSignInUserParams {
  domain: string;
  userId: string;
  passwordHash: string;
}

interface UpdateSignInUserParams {
  id: string;
  passwordHash: string;
}

const mapRowToEntity = (row: typeof signInUsers.$inferSelect): SignInUser => ({
  id: row.id,
  domain: row.domain,
  userId: row.userId,
  passwordHash: row.passwordHash,
  createdAt: row.createdAt ?? '',
  updatedAt: row.updatedAt ?? '',
});

export const findSignInUserByDomainAndUserId = async (
  db: D1Database,
  domain: string,
  userId: string,
): Promise<SignInUser | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signInUsers)
    .where(and(eq(signInUsers.domain, domain), eq(signInUsers.userId, userId)))
    .limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const findSignInUserById = async (
  db: D1Database,
  id: string,
): Promise<SignInUser | null> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle.select().from(signInUsers).where(eq(signInUsers.id, id)).limit(1);

  const row = results[0];
  if (!row) {
    return null;
  }

  return mapRowToEntity(row);
};

export const listSignInUsers = async (db: D1Database): Promise<readonly SignInUser[]> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle.select().from(signInUsers).orderBy(desc(signInUsers.createdAt));

  return results.map(mapRowToEntity);
};

export const listSignInUsersByDomain = async (
  db: D1Database,
  domain: string,
): Promise<readonly SignInUser[]> => {
  const drizzle = createDrizzleClient(db);
  const results = await drizzle
    .select()
    .from(signInUsers)
    .where(eq(signInUsers.domain, domain))
    .orderBy(desc(signInUsers.createdAt));

  return results.map(mapRowToEntity);
};

export const createSignInUser = async (
  db: D1Database,
  params: CreateSignInUserParams,
): Promise<SignInUser> => {
  const drizzle = createDrizzleClient(db);
  const id: string = generateUuid7();
  const now: string = new Date().toISOString();

  await drizzle.insert(signInUsers).values({
    id,
    domain: params.domain,
    userId: params.userId,
    passwordHash: params.passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  const created = await findSignInUserById(db, id);
  if (!created) {
    throw new Error('Failed to create sign-in user');
  }

  return created;
};

export const updateSignInUser = async (
  db: D1Database,
  params: UpdateSignInUserParams,
): Promise<SignInUser> => {
  const existing = await findSignInUserById(db, params.id);
  if (!existing) {
    throw new Error('Sign-in user not found');
  }

  const drizzle = createDrizzleClient(db);
  const now: string = new Date().toISOString();

  await drizzle
    .update(signInUsers)
    .set({
      passwordHash: params.passwordHash,
      updatedAt: now,
    })
    .where(eq(signInUsers.id, params.id));

  const updated = await findSignInUserById(db, params.id);
  if (!updated) {
    throw new Error('Failed to update sign-in user');
  }

  return updated;
};

export const deleteSignInUser = async (db: D1Database, id: string): Promise<boolean> => {
  const drizzle = createDrizzleClient(db);
  const result = await drizzle.delete(signInUsers).where(eq(signInUsers.id, id));

  return (result.meta?.changes ?? 0) > 0;
};
