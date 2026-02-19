// Health state synchronization across 3 tiers
// Execute with bun: wrangler dev

import { readHealthFromCache, writeHealthToCache } from './health-cache.ts';
import type { OutcomeReport } from './health-coordinator.ts';

// Interfaces at top
interface SyncHealthParams {
  readonly healthCoordinator: DurableObjectNamespace | undefined;
  readonly counters: Map<string, number>;
  readonly domain: string;
  readonly endpointCount: number;
}

interface ReportOutcomeParams {
  readonly healthCoordinator: DurableObjectNamespace | undefined;
  readonly domain: string;
  readonly index: number;
  readonly isSuccess: boolean;
  readonly isThrottle: boolean;
  readonly isServerError: boolean;
}

interface ModuleCacheEntry {
  readonly data: Record<string, number>;
  readonly cachedAt: number;
}

interface DoHealthResult {
  readonly counters: Record<string, number>;
  readonly keyCount: number;
}

interface DoStubWithRpc {
  readonly getHealthCounters: (domain: string, count: number) => Promise<DoHealthResult>;
  readonly reportOutcome: (report: OutcomeReport) => Promise<void>;
}

// Constants at top
const MODULE_CACHE_TTL_MS: number = 2000;
const LOG_PREFIX: string = '[ip-rotate]';
const DO_INSTANCE_NAME: string = 'default';

// Module-level cache for Durable Object health state
const moduleHealthCache: Map<string, ModuleCacheEntry> = new Map();

// Check if module-level cache entry is fresh
const isModuleCacheFresh = (entry: ModuleCacheEntry | undefined): entry is ModuleCacheEntry =>
  entry !== undefined && Date.now() - entry.cachedAt < MODULE_CACHE_TTL_MS;

// Merge remote health data into local counters
const mergeHealthIntoCounters = (
  counters: Map<string, number>,
  remote: Record<string, number>,
): void => {
  for (const [key, value] of Object.entries(remote)) {
    const local: number | undefined = counters.get(key);
    if (local === undefined || value > local) {
      counters.set(key, value);
    }
  }
};

// Get Durable Object stub with typed RPC
const getDoStub = (healthCoordinator: DurableObjectNamespace): DoStubWithRpc => {
  const id: DurableObjectId = healthCoordinator.idFromName(DO_INSTANCE_NAME);
  return healthCoordinator.get(id) as unknown as DoStubWithRpc;
};

// Update module cache and merge into counters
const populateAndMerge = (
  domain: string,
  data: Record<string, number>,
  counters: Map<string, number>,
): void => {
  moduleHealthCache.set(domain, { data, cachedAt: Date.now() });
  mergeHealthIntoCounters(counters, data);
};

// Fetch health state from Durable Object and populate caches
const fetchFromDurableObject = async (
  params: SyncHealthParams,
  coordinator: DurableObjectNamespace,
): Promise<void> => {
  const stub: DoStubWithRpc = getDoStub(coordinator);
  const startTime: number = Date.now();
  const result: DoHealthResult = await stub.getHealthCounters(params.domain, params.endpointCount);
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log(LOG_PREFIX, {
    event: 'health-sync-from-do',
    domain: params.domain,
    keyCount: result.keyCount,
    latencyMs: Date.now() - startTime,
  });
  await writeHealthToCache(params.domain, result.counters);
  // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
  console.log(LOG_PREFIX, {
    event: 'health-sync-cache-populated',
    domain: params.domain,
    keyCount: result.keyCount,
  });
  populateAndMerge(params.domain, result.counters, params.counters);
};

// Sync health state into local counters from 3-tier cache hierarchy
const syncHealthToCounters = async (params: SyncHealthParams): Promise<void> => {
  if (!params.healthCoordinator) return;

  try {
    // Tier 1: Module-level cache check
    const cached: ModuleCacheEntry | undefined = moduleHealthCache.get(params.domain);
    if (isModuleCacheFresh(cached)) {
      // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
      console.log(LOG_PREFIX, {
        event: 'health-module-cache-hit',
        domain: params.domain,
        ageMs: Date.now() - cached.cachedAt,
      });
      mergeHealthIntoCounters(params.counters, cached.data);
      return;
    }

    // Tier 2: Cache API check
    const cacheData: Record<string, number> | null = await readHealthFromCache(params.domain);
    if (cacheData) {
      populateAndMerge(params.domain, cacheData, params.counters);
      return;
    }

    // Tier 3: Durable Object
    await fetchFromDurableObject(params, params.healthCoordinator);
  } catch (error: unknown) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'health-sync-read-error',
      domain: params.domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Report outcome to Durable Object (called in waitUntil)
const reportOutcomeToDO = async (params: ReportOutcomeParams): Promise<void> => {
  if (!params.healthCoordinator) return;

  try {
    const stub: DoStubWithRpc = getDoStub(params.healthCoordinator);
    const report: OutcomeReport = {
      domain: params.domain,
      index: params.index,
      isSuccess: params.isSuccess,
      isThrottle: params.isThrottle,
      isServerError: params.isServerError,
    };
    await stub.reportOutcome(report);
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'health-sync-to-do',
      domain: params.domain,
      index: params.index,
    });
  } catch (error: unknown) {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'health-sync-write-error',
      domain: params.domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// Clear module cache (for testing)
const clearModuleHealthCache = (): void => {
  moduleHealthCache.clear();
};

export {
  clearModuleHealthCache,
  DO_INSTANCE_NAME,
  isModuleCacheFresh,
  mergeHealthIntoCounters,
  MODULE_CACHE_TTL_MS,
  moduleHealthCache,
  reportOutcomeToDO,
  syncHealthToCounters,
};

export type {
  DoHealthResult,
  DoStubWithRpc,
  ModuleCacheEntry,
  ReportOutcomeParams,
  SyncHealthParams,
};
