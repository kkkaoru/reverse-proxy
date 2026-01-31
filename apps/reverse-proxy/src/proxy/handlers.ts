// Proxy request handlers - aggregation module
// Execute with bun: wrangler dev

import { handleDeleteRequest } from './handlers/delete.ts';
import { handleProxyRequest } from './handlers/proxy.ts';
import type { ProxyCacheOptions, RequestHandler } from './types.ts';

// Re-exports
export { handleDeleteRequest } from './handlers/delete.ts';
export { handleProxyRequest } from './handlers/proxy.ts';
export { createErrorResponse, createJsonResponse } from './responses.ts';

// Create handler map
export const createHandlerMap = (options: ProxyCacheOptions): Record<string, RequestHandler> => ({
  GET: (target: string): Promise<Response> => handleProxyRequest(target, options),
  HEAD: (target: string): Promise<Response> => handleProxyRequest(target, options),
  DELETE: (target: string): Promise<Response> => handleDeleteRequest(target, options),
});
