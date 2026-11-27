/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3984 — every mutating route under app/api/tenant must either name a
 * permission or be an explicitly justified self-scoped exception. This test
 * reads the source tree so a new ungated route turns CI red immediately.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { SELF_SCOPED_MUTATIONS } from '@/lib/rbac/self-scoped-mutations';

const TENANT_API = join(process.cwd(), 'app/api/tenant');
const MUTATION = /export const (POST|PATCH|PUT|DELETE)\b/;
const GATE = /requirePerm\(|can\(ctx|ctx\.isAdmin|ctx\.isSuperAdmin/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function ungatedMutationKeys(): string[] {
  return routeFiles(TENANT_API)
    .filter((file) => {
      const source = readFileSync(file, 'utf8');
      return MUTATION.test(source) && !GATE.test(source);
    })
    .map((file) => relative(TENANT_API, file).replace(/\/route\.ts$/, '').split('\\').join('/'))
    .sort();
}

describe('#3984 mutating tenant routes are gated or explicitly self-scoped', () => {
  it('matches the allowlist exactly — no new ungated route, no stale exception', () => {
    expect(ungatedMutationKeys()).toEqual([...SELF_SCOPED_MUTATIONS].sort());
  });

  it('the allowlist contains only routes that still exist', () => {
    for (const key of SELF_SCOPED_MUTATIONS) {
      expect(() => readFileSync(join(TENANT_API, key, 'route.ts'), 'utf8')).not.toThrow();
    }
  });
});
