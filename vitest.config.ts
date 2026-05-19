import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'tests/unit/push-coverage.test.ts', 'tests/unit/massive-push.test.ts',
      'tests/unit/massive-coverage.test.ts', 'tests/unit/comprehensive-backend.test.ts', 'tests/unit/complete-backend.test.ts',
      'tests/unit/workflows.test.ts', 'tests/unit/modules.test.ts', 'tests/unit/validate-extended.test.ts',
      'tests/unit/auth-middleware.test.ts', 'tests/unit/auth-modules.test.ts', 'tests/unit/auth-cron.test.ts',
      'tests/unit/db-client.test.ts', 'tests/unit/db-client-extended.test.ts',
      'tests/integration/vulnerability-security.test.ts', 'tests/integration/critical-coverage.test.ts',
      'tests/integration/integrations.test.ts', 'tests/integration/calculated-fields.test.ts',
      'tests/unit/export.test.ts', 'tests/unit/queue.test.ts', 'tests/unit/errors.test.ts', 'tests/unit/rls.test.ts',
      'tests/unit/drizzle-schema.test.ts', 'tests/unit/email-service.test.ts',
      'tests/unit/formula-engine.test.ts', 'tests/unit/logger.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/validate.ts',
        'lib/cache/redis.ts',
        'lib/api-error.ts',
        'lib/errors.ts',
        'lib/security/brute-force.ts',
        'lib/rate-limit.ts',
        'lib/utils.ts',
        'lib/crypto.ts',
        'lib/logger.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 70,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
});
