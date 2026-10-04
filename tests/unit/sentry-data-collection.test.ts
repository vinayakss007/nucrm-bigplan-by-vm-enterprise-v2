/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DATA_COLLECTION } from '@/sentry-data-collection';

/**
 * The assertions are made against the SDK's own resolver rather than against
 * `DATA_COLLECTION` directly, because the claim under test is about Sentry's
 * defaults: v11 retired `sendDefaultPii` for a `dataCollection` option that is
 * ON unless told otherwise, so an omitted option is the maximum-PII setting.
 * Reading the resolver is the only way to notice a future Sentry that adds a
 * collector — our object would then be incomplete, and these tests fail.
 */
// The resolver is internal (package `exports` exposes only `.`, `./server`,
// `./browser`), so it is required by absolute path from the installed package.
const require_ = createRequire(import.meta.url);
const resolverPath = join(
  dirname(require_.resolve('@sentry/core/package.json')),
  'build/cjs/utils/data-collection/resolveDataCollectionOptions.js',
);

type Resolve = (options: { dataCollection?: unknown }) => Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolveDataCollection = ((require_(resolverPath) as any).resolveDataCollectionOptions) as Resolve;

/** Every path in a resolved options object that would cause data to be sent. */
function collectingPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'boolean') return value ? [prefix] : [];
  if (typeof value === 'number') return value > 0 ? [prefix] : [];
  if (Array.isArray(value)) return value.length > 0 ? [prefix] : [];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectingPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

describe('Sentry dataCollection opt-out', () => {
  it('documents that the SDK default is to collect everything', () => {
    // The hazard itself. If this ever comes back empty, Sentry changed defaults
    // upstream and the object below is no longer load-bearing — delete it then.
    expect(collectingPaths(resolveDataCollection({}))).toEqual(
      expect.arrayContaining([
        'userInfo',
        'cookies',
        'httpHeaders.request',
        'httpHeaders.response',
        'httpBodies',
        'urlQueryParams',
        'graphQL.document',
        'graphQL.variables',
        'genAI.inputs',
        'genAI.outputs',
        'databaseQueryData',
        'queues',
        'stackFrameVariables',
        'frameContextLines',
      ]),
    );
  });

  it('turns every collector off', () => {
    expect(collectingPaths(resolveDataCollection({ dataCollection: DATA_COLLECTION }))).toEqual([]);
  });

  it('covers every field the installed resolver knows about', () => {
    // A Sentry upgrade that adds a collector must be added to DATA_COLLECTION;
    // without this, the new field silently defaults to on.
    const sdkFields = Object.keys(resolveDataCollection({})).sort();
    expect(Object.keys(DATA_COLLECTION).sort()).toEqual(sdkFields);
  });

  it('is passed at every Sentry.init() call site in the repo', () => {
    // The reason PP-035 happened at all: `dataCollection` was added to one entry
    // point and the live browser entry kept the old comment. Guard the files,
    // not just the constant.
    const initSites = [
      'sentry.server.config.ts',
      'sentry.edge.config.ts',
      'sentry.client.config.ts',
      'instrumentation-client.ts',
    ];
    for (const file of initSites) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source, `${file} must pass dataCollection`).toContain('dataCollection: DATA_COLLECTION');
      expect(source, `${file} must not revive the "opt-in is off by default" claim`).not.toContain(
        'explicit `dataCollection` opt-in as off',
      );
    }
  });

  it('scrubs in the browser entry that the deployed bundle actually loads', () => {
    // `sentry.client.config.ts` is not injected by a Turbopack build, so the
    // browser's only defence is what instrumentation-client.ts wires up.
    const source = readFileSync(join(process.cwd(), 'instrumentation-client.ts'), 'utf8');
    expect(source).toContain('scrubPii');
    expect(source).toContain('beforeSend');
  });
});
