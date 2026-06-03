import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/validate.ts',
        'lib/cache/index.ts',
        'lib/cache/redis.ts',
        'lib/api-error.ts',
        'lib/errors.ts',
        'lib/security/brute-force.ts',
        'lib/rate-limit.ts',
        'lib/utils.ts',
        'lib/crypto.ts',
        'lib/logger.ts',
        'lib/stripe.ts',
        'lib/db/cache.ts',
        'lib/metrics.ts',
        'lib/tenant/request-context.ts',
        'lib/flags/index.ts',
        'lib/modules/registry.ts',
        'lib/formula/engine.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    testTimeout: 15000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
});
