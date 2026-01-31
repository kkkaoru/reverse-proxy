// Playwright route registration

import type { PlaywrightEnv } from '../playwright/handler.ts';
import type { HonoApp } from '../types/bindings.ts';

// Route path
export const PLAYWRIGHT_PATH: string = '/playwright';

// Register playwright routes
export const registerPlaywrightRoute = (instance: HonoApp): void => {
  instance.get(PLAYWRIGHT_PATH, async (c) => {
    const { handlePlaywrightRequest } = await import('../playwright/handler.ts');
    const env = c.env as unknown as PlaywrightEnv;
    return handlePlaywrightRequest(c.req.raw, env);
  });
  instance.delete(PLAYWRIGHT_PATH, async (c) => {
    const { handlePlaywrightDeleteRequest } = await import('../playwright/handler.ts');
    const env = c.env as unknown as PlaywrightEnv;
    return handlePlaywrightDeleteRequest(c.req.raw, env);
  });
};
