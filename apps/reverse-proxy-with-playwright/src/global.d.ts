// Global type declarations for Cloudflare Workers environment
// Execute with bun: wrangler dev

declare global {
  interface CacheStorage {
    default: Cache;
  }
}

export {};
