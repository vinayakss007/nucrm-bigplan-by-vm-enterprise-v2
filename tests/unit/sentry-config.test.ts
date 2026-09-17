import { afterEach, expect, it, vi } from 'vitest';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({ init }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it('passes the configured preprod environment and release to Sentry init', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_ENVIRONMENT', 'preprod');
  vi.stubEnv('SENTRY_RELEASE', 'test-release');
  vi.resetModules();

  await import('../../sentry.server.config');

  expect(init).toHaveBeenCalledTimes(1);
  expect(init).toHaveBeenCalledWith(expect.objectContaining({
    environment: 'preprod',
    release: 'test-release',
    sendDefaultPii: false,
  }));
});
