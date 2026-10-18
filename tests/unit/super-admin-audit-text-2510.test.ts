/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2510, disposition (2) — `drizzle/schema` must stop lying about
 * super_admin_audit_logs.
 *
 * 0002_flat_sir_ram.sql built old_data/new_data/metadata as TEXT;
 * 0007_super_admin_audit_logs.sql "created" the table again with jsonb inside
 * an inert `CREATE TABLE IF NOT EXISTS` that never executed anywhere — chain
 * build and pre-prod both measure text, and lib/audit/super-admin.ts writes
 * JSON.stringify and reads `string | null` end to end. The jsonb declaration
 * was not cosmetic: it is what `db:sync` (drizzle-kit push) would act on,
 * re-typing a security audit table on the strength of an unreviewed push
 * (PP-040 is the record of what that does).
 *
 * These tests pin the three halves of the fix:
 *   1. the schema declares text (and the drift allowlist loses its three
 *      `type:` entries — the #2508 ratchet exercised by a real fix);
 *   2. the writer semantics that made text the truth stay text (stringify in,
 *      string read, no ORM path assigning objects to the columns);
 *   3. the new root-cause screen (#2510 acceptance 5) catches the NEXT inert
 *      re-declaration — proven on synthetic migrations, then asserted green
 *      against the real chain with only its 18 recorded entries.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { findRedclarations, KNOWN_REDECLARATIONS } from '../../scripts/check-migration-redeclarations.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');

describe('drizzle/schema says text for the three columns (#2510)', () => {
  const src = readFileSync(join(ROOT, 'drizzle/schema/super-admin-audit.ts'), 'utf8');

  const cases = [
    ['oldData', 'old_data'],
    ['newData', 'new_data'],
    ['metadata', 'metadata'],
  ] as const;
  for (const [key, col] of cases) {
    it(`declares ${col} as text, never jsonb`, () => {
      expect(src).toMatch(new RegExp(`\\b${key}:\\s*text\\('${col}'\\)`));
      expect(src).not.toMatch(new RegExp(`\\b${key}:\\s*jsonb\\(`));
    });
  }

  it('no longer imports jsonb at all (nothing in this table declares it)', () => {
    expect(src).not.toMatch(/import\s*\{[^}]*\bjsonb\b[^}]*\}\s*from\s*'drizzle-orm\/pg-core'/);
  });
});

describe('schema-drift allowlist loses the three type: entries (#2510 acceptance 4)', () => {
  const allowlist = JSON.parse(readFileSync(join(ROOT, 'scripts/schema-drift-allowlist.json'), 'utf8'));

  it('has no type:super_admin_audit_logs entries left', () => {
    const keys = allowlist.entries.map((e: { key: string }) => e.key);
    expect(keys.filter((k: string) => k.startsWith('type:super_admin_audit_logs.'))).toEqual([]);
  });

  it('keeps the other ratcheted entries intact', () => {
    const keys = allowlist.entries.map((e: { key: string }) => e.key);
    expect(keys).toContain('nullability:segment_members.id');
    expect(keys).toContain('nullability:custom_entities.fields');
  });
});

describe('the writer treats the columns as text end to end (#2510 disposition rationale)', () => {
  const writer = readFileSync(join(ROOT, 'lib/audit/super-admin.ts'), 'utf8');

  it('stringifies values before writing them', () => {
    expect(writer).toMatch(/oldData \? JSON\.stringify\(entry\.oldData\)/);
  });

  it('reads them back as strings', () => {
    expect(writer).toMatch(/'old_data'\]\s*as string \| null/);
    expect(writer).toMatch(/'new_data'\]\s*as string \| null/);
  });

  it('stringifies metadata on the way in, too (the helper owns the text contract)', () => {
    expect(writer).toMatch(/metadata:\s*Object\.keys\(metadata\)\.length > 0 \? JSON\.stringify\(metadata\) : null/);
  });

  it('no ORM insert path can feed values around the stringify-only writer', () => {
    // The columns are text end to end *because* every write goes through
    // logSuperAdminAction, which stringifies. An `db.insert(superAdminAuditLogs)`
    // would hand pg an object for a text column and re-open the #2510 choice.
    const offenders: string[] = [];
    const scan = (absDir: string) => {
      for (const e of readdirSync(absDir, { withFileTypes: true })) {
        const p = join(absDir, e.name);
        if (e.isDirectory()) { scan(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (p.includes('drizzle/schema') || p.includes('super-admin.ts')) continue;
        const src = readFileSync(p, 'utf8');
        if (/\.insert\(\s*superAdminAuditLogs\b/.test(src)) offenders.push(p);
      }
    };
    scan(join(ROOT, 'app'));
    scan(join(ROOT, 'lib'));
    scan(join(ROOT, 'scripts'));
    expect(offenders).toEqual([]);
  });
});

describe('#2510 root-cause screen: inert CREATE TABLE IF NOT EXISTS re-declarations', () => {

  it('flags a later IF-NOT-EXISTS re-declaration of a table an earlier file created', () => {
    const r = findRedclarations([
      { name: '0001_a.sql', sql: 'CREATE TABLE "widgets" (\n  "id" uuid\n);' },
      { name: '0002_b.sql', sql: 'CREATE TABLE IF NOT EXISTS "widgets" (\n  "id" uuid,\n  "payload" jsonb\n);' },
    ], {});
    expect([...r.duplicates.keys()]).toEqual(['widgets']);
    expect(r.fresh.map(([t]) => t)).toEqual(['widgets']);
  });

  it('does NOT flag a bare later duplicate — it fails loudly, it is not inert', () => {
    const r = findRedclarations([
      { name: '0001_a.sql', sql: 'CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid);' },
      { name: '0002_b.sql', sql: 'CREATE TABLE "widgets" ("id" uuid);' },
    ], {});
    expect(r.duplicates.size).toBe(0);
  });

  it('ignores `--` comments and .down.sql recreations', () => {
    const r = findRedclarations([
      { name: '0001_a.sql', sql: 'CREATE TABLE "widgets" ("id" uuid);\n-- the CREATE TABLE IF NOT EXISTS "widgets" note' },
      { name: '0002_drop.down.sql', sql: 'CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid);' },
    ], {});
    expect(r.duplicates.size).toBe(0);
  });

  it('the real chain stays green with exactly the 18 recorded re-declarations, super_admin_audit_logs among them', () => {
    const dir = join(ROOT, 'drizzle', 'migrations');
    const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()
      .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
    const r = findRedclarations(files);
    expect(r.fresh.map(([t]) => t)).toEqual([]);
    expect(r.stale).toEqual([]);
    expect([...r.duplicates.keys()].sort()).toEqual(Object.keys(KNOWN_REDECLARATIONS).sort());
    expect(KNOWN_REDECLARATIONS['super_admin_audit_logs']).toContain('#2510');
  });

  it('every allowlisted re-declaration carries a written reason (debt record, not mute button)', () => {
    for (const [table, note] of Object.entries(KNOWN_REDECLARATIONS)) {
      expect(note, table).toBeTruthy();
      expect(typeof note, table).toBe('string');
    }
  });
});
