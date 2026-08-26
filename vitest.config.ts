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
      // Coverage target (re-baselined for vitest 4's AST-aware V8 remapping):
      // 77/80/66/78 (statements/functions/branches/statements-lines).
      // branches sits 1pt under the measured value for headroom — new files
      // (e.g. lib/whatsapp/webhook-processor.ts) otherwise flap the gate.
      //
      // The same suite measured 74/92/86/74 under vitest 2's V8 provider;
      // v4's remapping counts branches/functions more accurately, so the
      // absolute percentages shift. Thresholds track the new instrument.
      //
      // lib/**/index.ts excluded — barrel files with minimal executable code.
      // Only pure type files, test files, and the server-only shim remain excluded.
      //
      // Please do not add a module here to make a build pass.
      thresholds: {
        lines: 78,
        functions: 80,
        branches: 66,
        statements: 77,
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
