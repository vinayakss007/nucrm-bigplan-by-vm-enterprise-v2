/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3409 — every door that creates a deal has to count it.
 *
 * `tenants.currentDeals` is not decoration: `app/api/tenant/deals/import/route.ts`
 * prices an entire batch against `currentDeals + rows.length > maxDeals`, and the
 * usage panel shows the same number. Any path that inserts a deal and leaves the
 * counter alone therefore makes every later ceiling read low by exactly the deals
 * that path made — and nothing in the tree noticed, because each site looked
 * fine on its own.
 *
 * This screen is the ratchet: a production file that calls `insert(deals)` must
 * also move `currentDeals` atomically (`sql` on the column, never a
 * read-modify-write that loses concurrent writers). Commented-out examples do
 * not count — `lib/api/with-transaction.ts` documents one in its docblock.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Code only: comments cannot insert anything. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) yield path;
  }
}

/** Files that insert a deal in code, and whether they count it. */
function dealWriters() {
  const writers: { file: string; counts: boolean }[] = [];
  for (const dir of ['app', 'lib']) {
    for (const path of walk(join(ROOT, dir))) {
      const code = stripComments(readFileSync(path, 'utf8'));
      if (!/\binsert\(\s*deals\s*\)/.test(code)) continue;
      // The atomic forms in use: `sql\`${tenants.currentDeals} + n\`` and
      // `sql\`COALESCE(${tenants.currentDeals}, 0) + n\``.
      const counts = /currentDeals:\s*sql`[^`]*tenants\.currentDeals[^`]*\+/.test(code);
      writers.push({ file: relative(ROOT, path), counts });
    }
  }
  return writers;
}

describe('every deal-writer counts its row (#3409)', () => {
  it('finds the writers at all — an empty scan would pass vacuously', () => {
    expect(dealWriters().length).toBeGreaterThanOrEqual(8);
  });

  it('has no writer that inserts a deal and leaves currentDeals alone', () => {
    const uncounted = dealWriters()
      .filter((w) => !w.counts)
      .map((w) => w.file);

    expect(uncounted, 'a door that creates a deal must bump tenants.currentDeals').toEqual([]);
  });

  it('counts atomically — no read-modify-write of the counter', () => {
    const rw: string[] = [];
    for (const dir of ['app', 'lib']) {
      for (const path of walk(join(ROOT, dir))) {
        const code = stripComments(readFileSync(path, 'utf8'));
        // `.set({ currentDeals: (tenants.currentDeals ?? 0) + 1 })` is the JS half
        // of a race: under READ COMMITTED two writers read the same number and one
        // move is lost. Reading the counter to COMPARE against a plan ceiling
        // (`(plan.currentDeals ?? 0) + rows.length > maxDeals`) is fine and is not
        // what this matches — only a write.
        if (/set\(\s*\{[^}]*currentDeals:\s*\(/.test(code)) {
          rw.push(relative(ROOT, path));
        }
      }
    }

    expect(rw, 'the counter must move in SQL, not in the application').toEqual([]);
  });
});
