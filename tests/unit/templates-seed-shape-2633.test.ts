import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';

/**
 * #2633 — migration 0128 seeds the deprecated INDUSTRY_TEMPLATES map into
 * product_templates, making the DB the single source of truth. This test pins
 * the seed's shape: 13 builtins, slug = old hardcoded key, conflict-safe
 * re-run, super-admin GUC (PP-058: without it FORCE RLS silently seeds 0 rows).
 */

const MIG_DIR = join(__dirname, '..', '..', 'drizzle', 'migrations');
const up = readFileSync(join(MIG_DIR, '0128_seed_builtin_product_templates.sql'), 'utf8');
const down = readFileSync(join(MIG_DIR, '0128_seed_builtin_product_templates.down.sql'), 'utf8');

describe('0128 builtin template seed (#2633)', () => {
  it('seeds exactly the 13 templates from the static map, slug = legacy key', () => {
    const keys = Object.keys(INDUSTRY_TEMPLATES);
    expect(keys).toHaveLength(13);
    for (const key of keys) {
      expect(up, `missing builtin slug ${key}`).toContain(`'${key}'`);
    }
  });

  it('is idempotent: ON CONFLICT (slug) DO NOTHING', () => {
    expect(up).toMatch(/ON CONFLICT \("slug"\) DO NOTHING/i);
  });

  it('runs behind the app.is_super_admin GUC (PP-058 write-policy gate)', () => {
    expect(up).toContain("set_config('app.is_super_admin','true',true)");
  });

  it('adds the default_dashboard_layout column it fills', () => {
    expect(up).toContain('default_dashboard_layout');
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS "default_dashboard_layout" jsonb/);
  });

  it('down deletes builtins + assignment ledger, drops the column', () => {
    expect(down).toContain('tenant_templates');
    expect(down).toContain('is_builtin');
    expect(down).toMatch(/DROP COLUMN IF EXISTS "default_dashboard_layout"/);
  });

  it('down does not touch non-builtin (superadmin-authored) templates', () => {
    const deletes = down.split(';').filter((s) => /DELETE FROM/i.test(s));
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d).toContain('is_builtin');
  });
});
