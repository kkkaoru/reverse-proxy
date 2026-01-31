// Proxy request handlers - aggregation module
// Execute with bun: wrangler dev

import { handleBatchRequest } from './handlers/batch/handler.ts';
import { handleDeleteRequest } from './handlers/delete.ts';
import { handleProxyRequest } from './handlers/proxy.ts';
import type { BatchRequestHandler, ProxyCacheOptions, RequestHandler } from './types.ts';

// Re-exports
export { handleBatchRequest } from './handlers/batch/handler.ts';
export { handleDeleteRequest } from './handlers/delete.ts';
export { handleProxyRequest } from './handlers/proxy.ts';
export { createErrorResponse, createJsonResponse } from './responses.ts';

// Handler maps
interface HandlerMaps {
  readonly queryHandlers: Record<string, RequestHandler>;
  readonly batchHandler: BatchRequestHandler;
}

// Create handler maps
export const createHandlerMaps = (options: ProxyCacheOptions): HandlerMaps => ({
  queryHandlers: {
    GET: (target: string): Promise<Response> => handleProxyRequest(target, options),
    HEAD: (target: string): Promise<Response> => handleProxyRequest(target, options),
    DELETE: (target: string): Promise<Response> => handleDeleteRequest(target, options),
  },
  batchHandler: (body: unknown): Promise<Response> => handleBatchRequest(body, options),
});

// Create handler map (legacy - for backward compatibility)
export const createHandlerMap = (options: ProxyCacheOptions): Record<string, RequestHandler> =>
  createHandlerMaps(options).queryHandlers;
