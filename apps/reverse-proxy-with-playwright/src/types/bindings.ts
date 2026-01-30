// Cloudflare Workers binding type definitions
// Execute with bun: wrangler dev

import type { BrowserWorker } from '@cloudflare/playwright';

export interface WorkerBindings {
  BROWSER: BrowserWorker;
  DB: D1Database;
  KV: KVNamespace;
  PEPPER: string;
}
