// Drizzle ORM schema definitions for D1 database
// Execute with bun: wrangler dev

import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// biome-ignore lint/nursery/useExplicitType: Drizzle ORM uses complex generic types that are best inferred
export const signInSelectors = sqliteTable(
  'sign_in_selectors',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull().unique(),
    signInUrl: text('sign_in_url').notNull(),
    userIdSelector: text('user_id_selector').notNull(),
    passwordSelector: text('password_selector').notNull(),
    signInButtonSelector: text('sign_in_button_selector').notNull(),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (table) => [index('idx_sign_in_selectors_domain').on(table.domain)],
);

// biome-ignore lint/nursery/useExplicitType: Drizzle ORM uses complex generic types that are best inferred
export const secretKeys = sqliteTable(
  'secret_keys',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull().unique(),
    secretKeyBase64: text('secret_key_base64').notNull(),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (table) => [index('idx_secret_keys_domain').on(table.domain)],
);

// biome-ignore lint/nursery/useExplicitType: Drizzle ORM uses complex generic types that are best inferred
export const signedInValidationRegex = sqliteTable(
  'signed_in_validation_regex',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull().unique(),
    textSelector: text('text_selector').notNull(),
    isSignedInRegexPattern: text('is_signed_in_regex_pattern').notNull(),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (table) => [index('idx_signed_in_validation_domain').on(table.domain)],
);

// biome-ignore lint/nursery/useExplicitType: Drizzle ORM uses complex generic types that are best inferred
export const signInUsers = sqliteTable(
  'sign_in_users',
  {
    id: text('id').primaryKey(),
    domain: text('domain').notNull(),
    userId: text('user_id').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (table) => [
    index('idx_sign_in_users_domain_user').on(table.domain, table.userId),
    uniqueIndex('sign_in_users_domain_user_id_unique').on(table.domain, table.userId),
  ],
);
