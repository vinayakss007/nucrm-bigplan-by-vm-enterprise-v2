import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules',
      '.next',
      '.cache',
      '.config',
      '.local',
      'backups',
      'tmp',
      'leadgenious/*',
      'nucrm-opencode/**',
      'nu2-byopen-510/**',
      'nucrm-bigplan/**',
      'nucrm-bigplan2/**',
      'nucrm-enterprise/**',
      'nucrm-full-version/**',
      'nucrm-other-virsions-backup/**',
      'nucrm-vercel/**',
      'nucrmplus-bigplan/**',
      'vinayak-portfolio/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/?*.ts'],
      exclude: [
        'lib/**/*.test.ts',
        'lib/**/*.spec.ts',
        'lib/**/__tests__/**',
        'lib/automation/types.ts',
        'lib/calendar-sync/types.ts',
        'lib/integrations/types.ts',
        'lib/modules/sdk/types.ts',
        'lib/sdk/types.ts',
        'lib/sdk/modules.ts',
        'lib/server-only-shim.ts',
      ],
      // Coverage target: 80/80/90/80 (lines/functions/branches/statements).
      //
      // The lib/**/index.ts exclusion was removed — many index.ts files contain
      // substantial testable code (e.g. lib/cache/index.ts has a circuit breaker,
      // distributed locks, and rate limiting; lib/scim/index.ts has SCIM protocol
      // parsing; lib/flags/index.ts has feature flag logic). Only pure type
      // files, test files, and the server-only shim remain excluded.
      //
      // Please do not add a module here to make a build pass.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 90,
        statements: 80,
      },
    },
    testTimeout: 15000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './lib/server-only-shim.ts'),
    },
  },
});
