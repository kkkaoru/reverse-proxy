// Drizzle ORM client for Cloudflare D1
// Execute with bun: wrangler dev

import type { D1Database } from '@cloudflare/workers-types';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { drizzle } from 'drizzle-orm/d1';

import { secretKeys, signedInValidationRegex, signInSelectors, signInUsers } from './schema.ts';

// biome-ignore lint/nursery/useExplicitType: Drizzle schema object uses complex generic types
const schema = {
  signInSelectors,
  secretKeys,
  signedInValidationRegex,
  signInUsers,
};

export const createDrizzleClient = (d1: D1Database): DrizzleD1Database<typeof schema> =>
  drizzle(d1, { schema });

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;
