// Hono application setup for reverse proxy
// Execute with bun: wrangler dev

import { DEFAULT_PROXY_OPTIONS } from './app/constants.ts';
import { createApp } from './app/factory.ts';
import type { AppFetch, AppFetchArguments, HonoApp } from './types/bindings.ts';

// Re-exports
export { DEFAULT_PROXY_OPTIONS } from './app/constants.ts';
export { createApp } from './app/factory.ts';
export type {
  AppFetch,
  AppFetchArguments,
  HonoApp,
  ReverseProxyBindings,
} from './types/bindings.ts';

// Application instance
export const app: HonoApp = createApp(DEFAULT_PROXY_OPTIONS);

// Fetch handler
export const appFetch: AppFetch = (
  request: AppFetchArguments[0],
  env: AppFetchArguments[1],
  executionContext: AppFetchArguments[2],
): ReturnType<AppFetch> => app.fetch(request, env, executionContext);
