// Execute with bun: bunx vitest run --config vitest.config.ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT_DIR: string = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: ROOT_DIR,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(ROOT_DIR, 'coverage'),
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/constants.ts', 'src/global.d.ts', 'src/index.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
