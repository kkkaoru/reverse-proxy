// Durable Object for global endpoint health coordination
// Execute with bun: wrangler dev

// biome-ignore lint/nursery/noUnresolvedImports: Cloudflare Workers runtime module
import { DurableObject } from 'cloudflare:workers';
import { updateHealthScore } from './metrics.ts';

// Interfaces at top
interface OutcomeReport {
  readonly domain: string;
  readonly urlHash: string;
  readonly index: number;
  readonly isSuccess: boolean;
  readonly isThrottle: boolean;
  readonly isServerError: boolean;
}

interface HealthCountersResult {
  readonly counters: Record<string, number>;
  readonly keyCount: number;
}

interface CleanupResult {
  readonly removedCount: number;
  readonly remainingCount: number;
}

// Constants at top
const HEALTH_ENTRY_TTL_MS: number = 300000;
const CLEANUP_INTERVAL_MS: number = 60000;
const SAVE_DEBOUNCE_MS: number = 1000;
const LOG_PREFIX: string = '[health-coordinator]';
const THROTTLE_KEY_PREFIX: string = '429';
const FAILURE_KEY_PREFIX: string = '5xx';
const EWMA_KEY_PREFIX: string = 'ewma';
const EWMA_TS_KEY_PREFIX: string = 'ewmats';

// Key prefix check helpers
const isTimestampKey = (key: string): boolean =>
  key.startsWith(`${THROTTLE_KEY_PREFIX}:`) || key.startsWith(`${FAILURE_KEY_PREFIX}:`);

const isHealthKey = (key: string): boolean =>
  isTimestampKey(key) ||
  key.startsWith(`${EWMA_KEY_PREFIX}:`) ||
  key.startsWith(`${EWMA_TS_KEY_PREFIX}:`);

// Parse key to check domain and index validity.
// Supports both the legacy 3-part format `prefix:domain:index` and the newer
// 4-part `prefix:domain:urlHash:index` used by 5xx/6xx blacklists scoped
// per (URL, endpoint). The index is always the last segment.
const isKeyForDomain = (key: string, domain: string, endpointCount: number): boolean => {
  const parts: string[] = key.split(':');
  if (parts.length < 3 || parts[1] !== domain) return false;
  const indexStr: string = parts[parts.length - 1] ?? '';
  const index: number = Number.parseInt(indexStr, 10);
  return !Number.isNaN(index) && index >= 0 && index < endpointCount;
};

// Filter health-related keys for a given domain and endpoint count
const filterHealthKeys = (
  state: Map<string, number>,
  domain: string,
  endpointCount: number,
): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const [key, value] of state) {
    if (!isHealthKey(key)) continue;
    if (!isKeyForDomain(key, domain, endpointCount)) continue;
    result[key] = value;
  }
  return result;
};

// Remove stale timestamp entries
const cleanupStaleEntries = (state: Map<string, number>, now: number): CleanupResult => {
  const keysToRemove: string[] = [];
  for (const [key, value] of state) {
    if (!isTimestampKey(key)) continue;
    if (now - value >= HEALTH_ENTRY_TTL_MS) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    state.delete(key);
  }
  return { removedCount: keysToRemove.length, remainingCount: state.size };
};

// biome-ignore lint/style/noDefaultExport: Durable Object requires default-exportable class
export default class EndpointHealthCoordinator extends DurableObject {
  private state: Map<string, number> = new Map();
  private dirty: boolean = false;
  private loaded: boolean = false;

  override async alarm(): Promise<void> {
    const now: number = Date.now();
    const result: CleanupResult = cleanupStaleEntries(this.state, now);
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'alarm-cleanup',
      removedCount: result.removedCount,
      remainingCount: result.remainingCount,
    });
    if (this.dirty) {
      const startTime: number = Date.now();
      await this.ctx.storage.put(Object.fromEntries(this.state));
      this.dirty = false;
      // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
      console.log(LOG_PREFIX, {
        event: 'alarm-save',
        keyCount: this.state.size,
        saveTimeMs: Date.now() - startTime,
      });
    }
    await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const startTime: number = Date.now();
    const stored: Map<string, unknown> = await this.ctx.storage.list();
    for (const [key, value] of stored) {
      if (typeof value === 'number') {
        this.state.set(key, value);
      }
    }
    this.loaded = true;
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'storage-load',
      keyCount: this.state.size,
      loadTimeMs: Date.now() - startTime,
    });
    // Schedule cleanup alarm
    const currentAlarm: number | null = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }

  async getHealthCounters(domain: string, endpointCount: number): Promise<HealthCountersResult> {
    await this.ensureLoaded();
    const counters: Record<string, number> = filterHealthKeys(this.state, domain, endpointCount);
    const keyCount: number = Object.keys(counters).length;
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'get-counters',
      domain,
      endpointCount,
      keyCount,
    });
    return { counters, keyCount };
  }

  async reportOutcome(report: OutcomeReport): Promise<void> {
    await this.ensureLoaded();
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'report-outcome',
      domain: report.domain,
      index: report.index,
      outcome: report.isSuccess ? 'success' : report.isThrottle ? 'throttle' : 'failure',
    });
    // Update EWMA via shared logic using in-memory state as counters
    updateHealthScore({
      counters: this.state,
      domain: report.domain,
      index: report.index,
      isSuccess: report.isSuccess,
      isThrottle: report.isThrottle,
    });
    // Record failure/throttle timestamps. Server-error keys are scoped to
    // (domain, urlHash, index) so a 5xx/6xx on one URL does not blacklist
    // the endpoint for every other URL. Throttle keys stay domain-wide
    // because upstream rate limits apply to all URLs.
    if (report.isServerError) {
      this.state.set(
        `${FAILURE_KEY_PREFIX}:${report.domain}:${report.urlHash}:${report.index}`,
        Date.now(),
      );
    }
    if (report.isThrottle) {
      this.state.set(`${THROTTLE_KEY_PREFIX}:${report.domain}:${report.index}`, Date.now());
    }
    this.dirty = true;
    // Schedule save via alarm debounce
    const currentAlarm: number | null = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + SAVE_DEBOUNCE_MS);
    }
  }
}

export {
  CLEANUP_INTERVAL_MS,
  cleanupStaleEntries,
  filterHealthKeys,
  HEALTH_ENTRY_TTL_MS,
  isHealthKey,
  isKeyForDomain,
  isTimestampKey,
  LOG_PREFIX,
  SAVE_DEBOUNCE_MS,
};

export type { CleanupResult, HealthCountersResult, OutcomeReport };
