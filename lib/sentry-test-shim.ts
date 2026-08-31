/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Test-only stub for `@sentry/nextjs` (aliased in vitest.config.ts).
 *
 * Sentry has no business initializing during unit tests, and as of
 * @sentry/nextjs 10.72 its orchestrion bundler instrumentation
 * (`@sentry/server-utils/orchestrion/bundler/webpack`) is loaded eagerly and
 * crashes under the jsdom test environment with
 * "TypeError: The URL must be of scheme file" (it calls fileURLToPath on
 * `import.meta.url`, which Vite rewrites to a non-file URL). Stubbing the whole
 * package sidesteps that and keeps unit tests fast + deterministic.
 *
 * Only the members the app actually uses are provided; all are no-ops. Add new
 * ones here if the app starts calling additional Sentry APIs.
 */

const noop = (..._args: unknown[]): undefined => undefined;

export const init = noop;
export const captureException = (_error: unknown, ..._rest: unknown[]): string => 'test-event-id';
export const captureMessage = (_message: unknown, ..._rest: unknown[]): string => 'test-event-id';
export const addBreadcrumb = noop;
export const captureRequestError = noop;
export const captureRouterTransitionStart = noop;

// Build-time helper used by next.config.mjs — returns the config unchanged.
export const withSentryConfig = <T>(config: T, ..._rest: unknown[]): T => config;

// Catch-all so `Sentry.<anything>()` used elsewhere never throws in tests.
const handler: ProxyHandler<Record<string, unknown>> = {
  get(target, prop: string) {
    if (prop in target) return (target as Record<string, unknown>)[prop];
    return noop;
  },
};

const sentryStub = new Proxy(
  {
    init,
    captureException,
    captureMessage,
    addBreadcrumb,
    captureRequestError,
    captureRouterTransitionStart,
    withSentryConfig,
  } as Record<string, unknown>,
  handler,
);

export default sentryStub;
