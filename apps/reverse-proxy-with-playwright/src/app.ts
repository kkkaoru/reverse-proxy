// Hono app composition for reverse-proxy-with-playwright
// Execute with bun: wrangler dev

import { Hono } from 'hono';
import {
  ADMIN_HEALTHCHECK_PATH,
  HEALTHCHECK_PATH,
  PLAYWRIGHT_HEALTHCHECK_PATH,
  PLAYWRIGHT_PATH,
  PLAYWRIGHT_SIGNIN_PATH,
} from './constants.ts';
import type { WorkerBindings } from './global.d.ts';
import { authMiddleware } from './middleware/auth.ts';
import { handleHealthcheck } from './routes/healthcheck.ts';
import { playwrightHandler } from './routes/playwright.ts';
import { playwrightSignInHandler } from './routes/playwright-signin.ts';

export const app: Hono<{ Bindings: WorkerBindings }> = new Hono();

// Health check routes (no auth required)
app.get(HEALTHCHECK_PATH, handleHealthcheck);
app.get(ADMIN_HEALTHCHECK_PATH, handleHealthcheck);
app.get(PLAYWRIGHT_HEALTHCHECK_PATH, handleHealthcheck);

// Playwright routes (auth required)
app.get(PLAYWRIGHT_PATH, authMiddleware, playwrightHandler);
app.get(PLAYWRIGHT_SIGNIN_PATH, authMiddleware, playwrightSignInHandler);

export type AppType = typeof app;
