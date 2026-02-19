// Cloudflare Workers entry point
// Execute with bun: wrangler dev

import { type AppFetch, appFetch, type ReverseProxyBindings } from './app.ts';

// Types
type WorkerExport = ExportedHandler<ReverseProxyBindings>;

// Exports
export const fetch: AppFetch = appFetch;

// Durable Object export for wrangler
export { default as EndpointHealthCoordinator } from './ip-rotate/health-coordinator.ts';

// biome-ignore lint/style/noDefaultExport: Workers runtime requires default export.
export default { fetch: appFetch } satisfies WorkerExport;
