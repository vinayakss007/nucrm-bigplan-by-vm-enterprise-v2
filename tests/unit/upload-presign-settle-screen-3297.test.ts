/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3297 — every browser that PUTs bytes to a presigned URL must settle the row.
 *
 * The settle endpoint (`app/api/tenant/documents/[id]/verify/route.ts`) corrects
 * `documents.size_bytes` — the column `max_storage_gb` is summed from — against the
 * object the store actually holds. The row is written from the client's own declared
 * number (`app/api/tenant/documents/route.ts:126,218`), so an uploader that never
 * calls the settle leaves the meter reporting whatever the browser said.
 *
 * That is the #3298 failure shape, not a theoretical one: a control that only some
 * callers reach reads as working. `components/documents/documents-panel.tsx` and
 * `app/tenant/documents/page.tsx` are the two uploaders in the app, and the page is
 * the one that "already works" — which is precisely why nobody would think to check
 * it. This screen makes the check, over the whole tree, so a third uploader added
 * next month has to settle or fail CI.
 *
 * Enforced from `test-unit` rather than a new `guard:` alias for the reason recorded
 * in #3298: an alias with no ci.yml step is the defined-but-unwired shape the docs
 * census in #3281/#3282 fails on, and the cited coordinates in
 * `docs/infra/PREPROD-ISSUE-REGISTER.md` forbid inserting a CI job here.
 *
 * A scan that finds nothing is a broken scan, so the candidate set is asserted
 * non-empty and its membership is pinned — an exemption that is no longer needed is
 * a failure, same rule as `scripts/check-cron-auth.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');

/** Client sources, excluding tests and generated trees. Repo-relative paths. */
function sources(dir: string): string[] {
  const base = join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (entry.name.includes('.test.')) continue;
    const abs = join(String(entry.parentPath ?? entry.path), entry.name);
    out.push(abs.slice(ROOT.length + 1).replace(/\\/g, '/'));
  }
  return out.sort();
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** A file that signs bytes out to a store: PUT with a presigned upload URL. */
function presignUploaders(): string[] {
  return ['app', 'components', 'lib']
    .flatMap(sources)
    .filter((rel) => {
      const src = read(rel);
      const puts = /method:\s*['"]PUT['"]/.test(src);
      const signed = /uploadUrl|upload_url/.test(src);
      return puts && signed;
    });
}

const SETTLE_CALLED = /verifyUploadedDocument\s*\(/;

describe('every presigned uploader settles its row (#3297)', () => {
  const uploaders = presignUploaders();

  it('finds the uploaders at all — a scan with no targets proves nothing', () => {
    expect(uploaders.length, 'no client file PUTs to a presigned URL; the screen is broken')
      .toBeGreaterThan(0);
    // Pinned membership: if a third uploader appears it is in scope automatically,
    // and if one of these stops being an uploader the screen says so.
    expect(uploaders).toEqual(expect.arrayContaining([
      'app/tenant/documents/page.tsx',
      'components/documents/documents-panel.tsx',
    ]));
  });

  it.each(uploaders.map((rel) => [rel]))('%s reaches the settle endpoint', (rel) => {
    const src = read(rel);
    expect(src, `${rel} PUTs bytes to a presigned URL and never measures them back (#3297)`)
      .toMatch(SETTLE_CALLED);
  });

  it('keeps the settle helper reachable from the modules that call it', () => {
    for (const rel of uploaders) {
      const src = read(rel);
      if (!SETTLE_CALLED.test(src)) continue;
      expect(src, `${rel} calls the settle without importing it`).toContain('lib/documents/verify-upload');
    }
  });
});
