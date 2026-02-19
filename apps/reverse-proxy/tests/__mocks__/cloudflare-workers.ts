// Mock for cloudflare:workers in test environment
// Execute with bun: vitest

// Minimal DurableObject stub for testing
class DurableObject {
  protected ctx: DurableObjectState;
  protected env: Record<string, unknown>;
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.ctx = ctx;
    this.env = env;
  }
}

export { DurableObject };
