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
      include: ['lib/**/?*.ts'],
      exclude: [
        'lib/**/index.ts',
        'lib/**/*.test.ts',
        'lib/**/*.spec.ts',
        'lib/**/__tests__/**',
        'lib/ai/**',
        'lib/audit/**',
        'lib/backups/**',
        'lib/contacts/**',
        'lib/dashboard/**',
        'lib/db/services/**',
        'lib/lead-warming/**',
        'lib/leads/**',
        'lib/onboarding/**',
        'lib/plugins/**',
        'lib/restore/**',
        'lib/storage/**',
        'lib/usage/**',
      ],
      thresholds: {
        lines: 25,
        functions: 35,
        branches: 30,
        statements: 25,
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
