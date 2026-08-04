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
        'lib/automation/types.ts',
        'lib/calendar-sync/types.ts',
        'lib/integrations/types.ts',
        'lib/modules/sdk/types.ts',
        'lib/sdk/types.ts',
        'lib/sdk/modules.ts',
        'lib/server-only-shim.ts',
      ],
      // Coverage target: 72/72/82/72 (lines/functions/branches/statements).
      //
      // lib/**/index.ts excluded — barrel files with minimal executable code.
      // Only pure type files, test files, and the server-only shim remain excluded.
      //
      // Please do not add a module here to make a build pass.
      thresholds: {
        lines: 72,
        functions: 72,
        branches: 82,
        statements: 72,
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
