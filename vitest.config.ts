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
        'lib/**/index.ts',
        'lib/**/*.test.ts',
        'lib/**/*.spec.ts',
        'lib/**/__tests__/**',
        'lib/db/services/**',
        'lib/plugins/**',
        'lib/usage/**',
        'lib/automation/types.ts',
        'lib/calendar-sync/types.ts',
        'lib/integrations/types.ts',
        'lib/modules/sdk/types.ts',
        'lib/sdk/types.ts',
        'lib/sdk/modules.ts',
        'lib/server-only-shim.ts',
      ],
      // Coverage target: 70/70/80/70 (lines/functions/branches/statements).
      // Reached via incremental raises. Next step: reduce remaining exclusions
      // (lib/db/services, lib/plugins, lib/usage) once they have adequate tests.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 80,
        statements: 70,
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
