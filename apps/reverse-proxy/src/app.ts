import { Hono } from 'hono';
import { HEALTHCHECK_PATH, handleHealthcheck } from './healthcheck.ts';
import { createProxyCacheMiddleware, type ProxyCacheOptions } from './middleware.ts';

export interface ReverseProxyBindings {
  LOG_REQUESTS?: string;
}

export const DEFAULT_PROXY_OPTIONS: ProxyCacheOptions = {
  enableLogging: true,
};

export const createApp = (
  options: ProxyCacheOptions = DEFAULT_PROXY_OPTIONS,
): Hono<{ Bindings: ReverseProxyBindings }> => {
  const instance: Hono<{ Bindings: ReverseProxyBindings }> = new Hono();
  instance.use('/', createProxyCacheMiddleware(options));
  instance.get(HEALTHCHECK_PATH, handleHealthcheck);
  return instance;
};

export const app: Hono<{ Bindings: ReverseProxyBindings }> = createApp(DEFAULT_PROXY_OPTIONS);
