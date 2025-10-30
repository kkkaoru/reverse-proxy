import { type AppFetch, appFetch, type ReverseProxyBindings } from './app.ts';

type WorkerExport = ExportedHandler<ReverseProxyBindings>;

export const fetch: AppFetch = appFetch;
// biome-ignore lint/style/noDefaultExport: Workers runtime accepts a default export helper shape.
export default { fetch: appFetch } satisfies WorkerExport;
