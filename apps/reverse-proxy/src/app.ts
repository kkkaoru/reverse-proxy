// Hono application setup for reverse proxy
// Execute with bun: wrangler dev

import { Hono } from 'hono';
import type { PlaywrightEnv } from './playwright/handler.ts';
import { createProxyCacheMiddleware } from './proxy/middleware.ts';
import type { ProxyCacheStaticOptions } from './proxy/types.ts';
import { HEALTHCHECK_PATH, handleHealthcheck } from './routes/healthcheck.ts';

// Interfaces
export interface ReverseProxyBindings {
  LOG_REQUESTS?: string;
  BROWSER?: unknown;
  KV?: KVNamespace;
  CACHE_VERSION?: string;
}

// Types
type HonoApp = Hono<{ Bindings: ReverseProxyBindings }>;

// Constants
const PLAYWRIGHT_PATH: string = '/playwright';
const ROOT_PATH: string = '/';

export const DEFAULT_PROXY_OPTIONS: ProxyCacheStaticOptions = {
  enableLogging: true,
};

// Functions
const registerPlaywrightRoute = (instance: HonoApp): void => {
  instance.get(PLAYWRIGHT_PATH, async (c) => {
    const { handlePlaywrightRequest } = await import('./playwright/handler.ts');
    const env = c.env as unknown as PlaywrightEnv;
    return handlePlaywrightRequest(c.req.raw, env);
  });
  instance.delete(PLAYWRIGHT_PATH, async (c) => {
    const { handlePlaywrightDeleteRequest } = await import('./playwright/handler.ts');
    const env = c.env as unknown as PlaywrightEnv;
    return handlePlaywrightDeleteRequest(c.req.raw, env);
  });
};

export const createApp = (options: ProxyCacheStaticOptions): HonoApp => {
  const instance: HonoApp = new Hono();
  instance.use(ROOT_PATH, createProxyCacheMiddleware(options));
  instance.get(HEALTHCHECK_PATH, handleHealthcheck);
  registerPlaywrightRoute(instance);
  return instance;
};

export const app: HonoApp = createApp(DEFAULT_PROXY_OPTIONS);

export type AppFetch = typeof app.fetch;
export type AppFetchArguments = Parameters<AppFetch>;

export const appFetch: AppFetch = (
  request: AppFetchArguments[0],
  env: AppFetchArguments[1],
  executionContext: AppFetchArguments[2],
): ReturnType<AppFetch> => app.fetch(request, env, executionContext);
