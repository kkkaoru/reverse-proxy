// biome-ignore lint/correctness/noNodejsModules: Vitest configuration executes in Node.js, so built-ins are allowed here.
// biome-ignore lint/nursery/noUnresolvedImports: Node.js built-ins resolve at runtime within Vitest.
import { resolve } from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: Vitest configuration executes in Node.js, so built-ins are allowed here.
// biome-ignore lint/nursery/noUnresolvedImports: Node.js built-ins resolve at runtime within Vitest.
import { fileURLToPath } from 'node:url';
// biome-ignore lint/nursery/noUnresolvedImports: Vitest exposes its config helper under this subpath.
import { defineConfig } from 'vitest/config';

const rootDir: string = fileURLToPath(new URL('.', import.meta.url));

// biome-ignore lint/style/noDefaultExport: Vitest CLI loads configuration via a default export.
export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      'cloudflare:workers': resolve(rootDir, 'tests/__mocks__/cloudflare-workers.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(rootDir, 'coverage'),
      exclude: [
        'src/playwright/handler.ts', // Requires @cloudflare/playwright runtime
        'src/routes/playwright.ts', // Dynamic import of handler.ts, requires Workers runtime
        'src/ip-rotate/health-coordinator.ts', // Durable Object class requires Workers runtime
        'src/**/types.ts', // Type-only files with no runtime code
        'src/types/**', // Type-only directory
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
