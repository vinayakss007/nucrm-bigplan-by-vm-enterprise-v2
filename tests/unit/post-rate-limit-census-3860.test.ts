/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TENANT_API = path.join(ROOT, 'app', 'api', 'tenant');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function unthrottledPostRoutes(): string[] {
  return routeFiles(TENANT_API)
    .filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('export const POST')
        && !/rateLimitMutating\(|checkRateLimit\(/.test(src);
    })
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();
}

/** #3860: no per-route debt remains; a new POST route must bring its own limit. */
const BASELINE: readonly string[] = [];

describe('tenant POST rate-limit census (#3860)', () => {
  it('has no unthrottled POST route', () => {
    expect(unthrottledPostRoutes()).toEqual([]);
  });

  it('keeps the ledger empty when a new tenant POST route lands', () => {
    const added = unthrottledPostRoutes().filter((file) => !BASELINE.includes(file));
    expect(added).toEqual([]);
  });
});
