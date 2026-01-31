// Storage state key utility
// Execute with bun: wrangler dev

export const STORAGE_STATE_KEY_PREFIX = 'storage-state';

export const buildStorageStateKey = (domain: string, userId: string): string =>
  `${STORAGE_STATE_KEY_PREFIX}::${domain}::${userId}`;
