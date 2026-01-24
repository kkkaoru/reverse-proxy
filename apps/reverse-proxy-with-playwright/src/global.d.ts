// Global type declarations for Cloudflare Workers environment
// Execute with bun: wrangler dev

import type { BrowserWorker } from '@cloudflare/playwright';

declare global {
  interface CacheStorage {
    default: Cache;
  }
}

export interface WorkerBindings {
  BROWSER: BrowserWorker;
  DB: D1Database;
  KV: KVNamespace;
  PEPPER: string;
}
