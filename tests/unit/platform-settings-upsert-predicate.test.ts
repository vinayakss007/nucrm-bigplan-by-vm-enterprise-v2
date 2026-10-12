import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * `platform_settings` is unique on two *partial* indexes:
 *   (key, tenant_id) WHERE tenant_id IS NOT NULL   — tenant-scoped rows
 *   (key)           WHERE tenant_id IS NULL       — global rows
 *
 * Postgres cannot infer a partial index from the conflict target alone; the
 * statement has to restate the predicate with `targetWhere`. Without it the
 * upsert throws `42P10 there is no unique or exclusion constraint matching the
 * ON CONFLICT specification` — which surfaced as 500s on ip-whitelist, portal
 * config, backup config, trash settings, custom reports and the super-admin
 * settings POST. This guard fails the suite if anyone adds or edits such an
 * upsert back into the broken shape.
 */

function tsFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...tsFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The argument object of an `onConflictDoUpdate({ ... })` call, brace-matched. */
function conflictBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /\.onConflictDoUpdate\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    blocks.push(src.slice(m.index + m[0].length, i - 1));
  }
  return blocks;
}

const files = ['app', 'lib', 'worker', 'scripts', 'db']
  .flatMap((d) => tsFiles(join(process.cwd(), d)))
  .filter((f) => readFileSync(f, 'utf-8').includes('onConflictDoUpdate'));

describe('platform_settings upserts', () => {
  it('finds the known conflict sites (guard is not vacuously passing)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(process.cwd().length + 1), f]))(
    '%s restates the partial-index predicate',
    (_rel, abs) => {
      const src = readFileSync(abs, 'utf-8');
      for (const block of conflictBlocks(src)) {
        if (!/platformSettings\.(tenantId|key)/.test(block)) continue;
        expect(block, `${_rel}: platformSettings upsert needs targetWhere`).toMatch(/targetWhere/);
      }
    },
  );

  it('pins the predicate to the right index on every tenant-scoped upsert', () => {
    const tenantScoped = [
      'app/api/tenant/security/ip-whitelist/route.ts',
      'app/api/tenant/portal/config/route.ts',
      'app/api/tenant/backup/config/route.ts',
      'app/api/tenant/reports/custom/route.ts',
      'app/api/tenant/trash/settings/route.ts',
    ];
    for (const rel of tenantScoped) {
      const blocks = conflictBlocks(readFileSync(join(process.cwd(), rel), 'utf-8'));
      const hits = blocks.filter((b) => /platformSettings\./.test(b));
      expect(hits, `${rel} should contain a platformSettings upsert`).toHaveLength(1);
      expect(hits[0]).toMatch(/targetWhere:\s*sql`\$\{platformSettings\.tenantId\} is not null`/);
    }
  });

  it('uses the key-only target with the IS NULL predicate for global rows', () => {
    const blocks = conflictBlocks(
      readFileSync(join(process.cwd(), 'app/api/superadmin/settings/route.ts'), 'utf-8'),
    ).filter((b) => /platformSettings\./.test(b));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(/target:\s*\[platformSettings\.key\]/);
    expect(blocks[0]).toMatch(/targetWhere:\s*sql`\$\{platformSettings\.tenantId\} is null`/);
  });
});
