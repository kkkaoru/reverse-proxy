// Application factory for creating Hono instances

import { Hono } from 'hono';
import { createProxyCacheMiddleware } from '../proxy/middleware.ts';
import type { ProxyCacheStaticOptions } from '../proxy/types.ts';
import { HEALTHCHECK_PATH, handleHealthcheck } from '../routes/healthcheck.ts';
import { registerPlaywrightRoute } from '../routes/playwright.ts';
import type { HonoApp } from '../types/bindings.ts';
import { ROOT_PATH } from './constants.ts';

// Create and configure Hono application
export const createApp = (options: ProxyCacheStaticOptions): HonoApp => {
  const instance: HonoApp = new Hono();
  instance.use(ROOT_PATH, createProxyCacheMiddleware(options));
  instance.get(HEALTHCHECK_PATH, handleHealthcheck);
  registerPlaywrightRoute(instance);
  return instance;
};
