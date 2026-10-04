import { afterEach, expect, it, vi } from 'vitest';
import { DATA_COLLECTION } from '../../sentry-data-collection';

const { init, readFileSync } = vi.hoisted(() => ({
  init: vi.fn(),
  readFileSync: vi.fn((): string => ''),
}));

vi.mock('@sentry/nextjs', () => ({ init }));
vi.mock('node:fs', () => ({ readFileSync }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

function initOptions(): Record<string, unknown> {
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0] as Record<string, unknown>;
}

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
  }));

  // v11 removed `sendDefaultPii` and replaced it with `dataCollection`, whose
  // defaults are all ON (PP-035). So privacy rests on passing every field off,
  // not on leaving the option out — asserting absence here would have asserted
  // the leak. The field-by-field shape is pinned in sentry-data-collection.test.
  const options = init.mock.calls[0]?.[0] ?? {};
  expect(options).not.toHaveProperty('sendDefaultPii');
  expect(options.dataCollection).toEqual(DATA_COLLECTION);
});

it('labels events with the Next build id when no release is configured', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  readFileSync.mockReturnValue('  build-id-from-next  \n');

  await import('../../sentry.server.config');

  expect(initOptions()).toMatchObject({ release: 'build-id-from-next' });
});

it('omits the release rather than sending an empty one when the build id is unreadable', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  readFileSync.mockImplementation(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });

  await import('../../sentry.server.config');

  expect(initOptions()).not.toHaveProperty('release');
});

it('honours SENTRY_DISABLE=true as the kill switch', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_DISABLE', 'true');

  await import('../../sentry.server.config');

  expect(initOptions()).toMatchObject({ enabled: false });
});

it('honours SENTRY_ENABLE=false, the switch the runbook documents', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_ENABLE', 'false');

  await import('../../sentry.server.config');

  expect(initOptions()).toMatchObject({ enabled: false });
});

it('stays enabled when a DSN is set and neither switch says otherwise', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');

  await import('../../sentry.server.config');

  expect(initOptions()).toMatchObject({ enabled: true });
});

it('does not initialize at all without a DSN', async () => {
  vi.stubEnv('SENTRY_DSN', '');

  await import('../../sentry.server.config');

  expect(init).not.toHaveBeenCalled();
});

it('edge config honours both documented kill switches', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_ENABLE', 'false');

  await import('../../sentry.edge.config');

  expect(initOptions()).toMatchObject({ enabled: false });

  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('SENTRY_DISABLE', 'true');

  await import('../../sentry.edge.config');

  expect(initOptions()).toMatchObject({ enabled: false });
});
