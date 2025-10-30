import type { ReverseProxyBindings } from './app.ts';
import { app } from './app.ts';

type FetchArguments = Parameters<typeof app.fetch>;

const fetchImpl: typeof app.fetch = (
  request: FetchArguments[0],
  env: FetchArguments[1],
  executionContext: FetchArguments[2],
) => app.fetch(request, env, executionContext);

type WorkerExport = ExportedHandler<ReverseProxyBindings>;

export type { ReverseProxyBindings } from './app.ts';
export { app, createApp, DEFAULT_PROXY_OPTIONS } from './app.ts';
export const fetch: typeof app.fetch = fetchImpl;
// biome-ignore lint/style/noDefaultExport: Workers runtime accepts a default export helper shape.
export default { fetch: fetchImpl } satisfies WorkerExport;
