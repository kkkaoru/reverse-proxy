// Browser launcher wrapper for testability
// Execute with bun: wrangler dev

import {
  type Browser,
  type BrowserWorker,
  launch as playwrightLaunch,
} from '@cloudflare/playwright';

export const launchBrowser = async (browserWorker: BrowserWorker): Promise<Browser> =>
  playwrightLaunch(browserWorker);
