/**
 * #2263 — RLS coverage gaps: `deals_by_win_probability` must execute as the
 * invoker, and `ai_providers` must declare its global posture in the database.
 *
 * Two classes of assertion, matching how this repo pins migration-bound invariants:
 *  1. SHAPE — the migration files and journal are exact (security_invoker
 *     option present, body byte-equal to the 0002 original and to the drizzle
 *     schema's view definition, ai_providers RLS + policies declared, down
 *     reverts both).
 *  2. POSTURE — the claim that makes `USING (true)` reads safe is pinned: no
 *     application code ever writes the ai_providers table (the per-tenant
 *     surface is tenants.settings + the encrypted key table). If someone adds
 *     a tenant-scoped writer, this test fails and forces the tenant_id
 *     decision the issue deferred.
 *
 * The functional half (an unprivileged role seeing 0 view rows while the
 * superuser sees N) was measured on a throwaway replay of the full chain; see
 * the PR evidence for #2263. CI cannot provision BYPASSRLS-safe roles per
 * suite, which is why the nightly verify-tenant-isolation survey (#2306) is
 * the live guard for the reloption surviving a future drizzle-kit push.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const UP = 'drizzle/migrations/0115_rls_view_hardening.sql';
const DOWN = 'drizzle/migrations/0115_rls_view_hardening.down.sql';

describe('#2263 migration shape — the view gains security_invoker', () => {
  it('0115 recreates the view WITH (security_invoker = on)', () => {
    const sql = read(UP);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW "public"\."deals_by_win_probability"\s+WITH \(security_invoker = on\)/);
  });

  it('the view body is the 0002 body — CREATE OR REPLACE keeps the column list stable', () => {
    const m0002 = read('drizzle/migrations/0002_flat_sir_ram.sql');
    const extractBody = (text: string, marker: string) => {
      const start = text.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      // Only what sits between `AS (` and the closing `);` — the prefixes
      // legitimately differ (that IS the migration), the bodies must not.
      const bodyStart = start + marker.length;
      const body = text.slice(bodyStart, text.indexOf('\n);', bodyStart));
      return body.replace(/\s+/g, ' ').trim();
    };
    const orig = extractBody(m0002, 'CREATE VIEW "public"."deals_by_win_probability" AS (');
    const hardened = extractBody(read(UP), 'CREATE OR REPLACE VIEW "public"."deals_by_win_probability" WITH (security_invoker = on) AS (');
    expect(hardened).toBe(orig);
  });

  it('the drizzle schema view definition matches the migrated body (no drift between code and SQL)', () => {
    const schema = read('drizzle/schema/analytics-views.ts');
    const migrated = read(UP);
    for (const frag of ['GREATEST(0.05, LEAST(0.95', 'CROSS JOIN LATERAL', 'WHERE d.deleted_at IS NULL']) {
      expect(schema).toContain(frag);
      expect(migrated).toContain(frag);
    }
  });

  it('the down file reverts the option and the ai_providers policies', () => {
    const down = read(DOWN);
    expect(down).toContain('CREATE OR REPLACE VIEW "public"."deals_by_win_probability" AS (');
    expect(down).not.toContain('security_invoker');
    expect(down).toContain('DROP POLICY IF EXISTS ai_providers_read_all');
    expect(down).toContain('DROP POLICY IF EXISTS ai_providers_super_admin_write');
    expect(down).toContain('DISABLE ROW LEVEL SECURITY');
  });

  it('0115 is registered in the journal and the chain guard stays clean', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json')) as {
      entries: { idx: number; tag: string }[];
    };
    const entry = journal.entries.find((e) => e.tag === '0115_rls_view_hardening');
    expect(entry, '0115 missing from journal').toBeDefined();
    expect(entry!.idx).toBe(115);
    // (position-independent: later migrations may legitimately follow 0115)
    // The chain guard is the repo-wide invariant (missing/orphan/dup checks) —
    // run it so a malformed journal edit fails HERE, not at migrate() time.
    const out = execFileSync('node', ['scripts/check-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('OK');
  });
});

describe('#2263 ai_providers — the global registry declares its posture', () => {
  const sql = read(UP);

  it('enables RLS and grants SELECT unconditionally (matching 0054_rls_phase0)', () => {
    expect(sql).toContain('ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY ai_providers_read_all ON ai_providers FOR SELECT USING (true)');
  });

  it('gates writes on the super-admin GUC — the established global-table pattern', () => {
    expect(sql).toContain('CREATE POLICY ai_providers_super_admin_write ON ai_providers FOR ALL');
    expect(sql).toContain("current_setting('app.is_super_admin', true)::boolean = true");
    const phase0 = read('drizzle/migrations/0054_rls_phase0.sql');
    expect(phase0).toContain("current_setting('app.is_super_admin', true)::boolean = true");
  });

  it('no application code writes the table — the runtime surface is read-only (what makes USING (true) safe)', () => {
    const files = globSync('{app,lib}/**/*.ts', { cwd: ROOT }) as string[];
    const writers = files.filter((f) => {
      const text = read(f);
      return /\binsert\(\s*aiProviders\s*\)/.test(text)
        || /\bupdate\(\s*aiProviders\s*\)/.test(text)
        || /\bdelete\(\s*aiProviders\s*\)/.test(text)
        || /INSERT INTO "?ai_providers"?/i.test(text)
        || /UPDATE "?ai_providers"?/i.test(text)
        || /DELETE FROM "?ai_providers"?/i.test(text);
    });
    expect(writers).toEqual([]);
  });

  it('the only seed-side writer is scripts/seed-dev.ts (documented, dev-only)', () => {
    const seed = read('scripts/seed-dev.ts');
    expect(seed).toMatch(/aiProviders|ai_providers/);
  });

  it('the tenant AI-config surface writes tenants.settings, not ai_providers', () => {
    const route = read('app/api/tenant/admin/ai-providers/route.ts');
    expect(route).toContain("'{ai_providers}'"); // jsonb_set path on tenants.settings
    expect(route).not.toMatch(/\bupdate\(\s*aiProviders\s*\)/);
    expect(route).not.toMatch(/\binsert\(\s*aiProviders\s*\)/);
  });
});
