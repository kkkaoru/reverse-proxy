// Type definitions for reverse proxy application

import type { Hono } from 'hono';

// Cloudflare Workers bindings
export interface ReverseProxyBindings {
  LOG_REQUESTS?: string;
  BROWSER?: unknown;
  KV?: KVNamespace;
  CACHE_VERSION?: string;
  ENABLE_CACHE_API?: string;
}

// Hono app type with bindings
export type HonoApp = Hono<{ Bindings: ReverseProxyBindings }>;

// App fetch function types
export type AppFetch = HonoApp['fetch'];
export type AppFetchArguments = Parameters<AppFetch>;
