import { Hono } from 'hono';
import { HEALTHCHECK_PATH, handleHealthcheck } from './healthcheck.ts';
import {
  type CacheWarmMessage,
  createProxyCacheMiddleware,
  type ProxyCacheOptions,
  processCacheWarmMessage,
} from './middleware.ts';

interface Bindings {
  CACHE_WARM_QUEUE: Queue;
}

const DEFAULT_QUEUE_BINDING = 'CACHE_WARM_QUEUE';
const DEFAULT_QUEUE_DELAY_SECONDS = 1;

export const createApp = (options: ProxyCacheOptions): Hono<{ Bindings: Bindings }> => {
  const instance: Hono<{ Bindings: Bindings }> = new Hono<{ Bindings: Bindings }>();
  instance.use('/', createProxyCacheMiddleware(options));
  instance.get(HEALTHCHECK_PATH, handleHealthcheck);
  return instance;
};

const PROXY_OPTIONS: ProxyCacheOptions = {
  enableLogging: true,
  queueBinding: DEFAULT_QUEUE_BINDING,
  queueDelaySeconds: DEFAULT_QUEUE_DELAY_SECONDS,
};

const app: Hono<{ Bindings: Bindings }> = createApp(PROXY_OPTIONS);

type FetchArguments = Parameters<typeof app.fetch>;

const fetchImpl: typeof app.fetch = (
  request: FetchArguments[0],
  env: FetchArguments[1],
  executionContext: FetchArguments[2],
) => app.fetch(request, env, executionContext);

type WorkerExport = ExportedHandler<Bindings>;
type QueueHandler = NonNullable<WorkerExport['queue']>;

const queueImpl: QueueHandler = async (
  batch: MessageBatch<unknown>,
  _env: Bindings,
  _ctx: ExecutionContext,
) => {
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await processCacheWarmMessage(message.body as CacheWarmMessage, {
          enableLogging: true,
        });
        message.ack();
      } catch (error) {
        // biome-ignore lint/suspicious/noConsole: queue processing diagnostics required.
        console.error('[reverse-proxy]', 'queue-error', {
          error,
          target: (message.body as CacheWarmMessage | undefined)?.target,
        });
        message.retry();
      }
    }),
  );
};

export { app };
export const fetch: typeof app.fetch = fetchImpl;
export const queue: QueueHandler = queueImpl;
// biome-ignore lint/style/noDefaultExport: Workers runtime accepts a default export helper shape.
export default { fetch: fetchImpl, queue: queueImpl } satisfies WorkerExport;
