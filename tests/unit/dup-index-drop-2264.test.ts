import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../drizzle/schema';

/**
 * #2264 — 20 exact-duplicate indexes (same table, key columns, opclasses,
 * null ordering, predicate) dropped by migration 0116_drop_duplicate_indexes.
 * Detection used a strict pg_index comparison (the issue's naive indkey-only
 * query reported 25 and false-flagged btree-vs-gin pairs).
 *
 * These tests pin the invariant that makes the drop safe:
 *  - every dropped member is gone from the DB snapshot AND undeclared in
 *    drizzle/schema (so `drizzle-kit push` cannot regrow it),
 *  - every kept member (constraint-backed unique / unique / schema-declared)
 *    is still live in the snapshot,
 *  - the down migration recreates exactly the same 20 objects,
 *  - the #2255 drift guard's duplicate allowlist is emptied because none of
 *    its members survives this migration.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const UP = join(ROOT, 'drizzle/migrations/0116_drop_duplicate_indexes.sql');
const DOWN = join(ROOT, 'drizzle/migrations/0116_drop_duplicate_indexes.down.sql');

/** dropped member -> kept member (must remain live + declared/backed) */
const PAIRS: Record<string, string> = {
  idx_users_email: 'users_email_unique',
  idx_sessions_token: 'sessions_token_hash_unique',
  idx_tenants_slug: 'tenants_slug_unique',
  idx_contact_scores_contact: 'contact_scores_contact_id_unique',
  idx_csat_token: 'csat_surveys_token_key',
  idx_forms_slug: 'forms_slug_unique',
  idx_oauth_clients_client_id: 'oauth_clients_client_id_unique',
  idx_oauth_codes_code: 'oauth_codes_code_unique',
  idx_oauth_tokens_access: 'oauth_tokens_access_token_unique',
  idx_oauth_tokens_refresh: 'oauth_tokens_refresh_token_unique',
  idx_plans_slug: 'plans_slug_unique',
  idx_portal_clients_token: 'portal_clients_access_token_unique',
  idx_product_templates_slug: 'product_templates_slug_unique',
  idx_tickets_portal_token: 'support_tickets_portal_token_unique',
  idx_tenant_ai_credits_period: 'tenant_ai_credits_tenant_id_billing_period_key',
  idx_token_budgets_service: 'idx_token_budgets_service_period',
  idx_webhook_queue_webhook_id: 'idx_webhook_deliveries_webhook_id',
  idx_webhook_queue_status: 'idx_webhook_deliveries_status',
  idx_webhook_queue_next_retry: 'idx_webhook_deliveries_next_retry',
  idx_territories_tenant_id: 'idx_territories_tenant',
};
const DROPPED = Object.keys(PAIRS);

const SNAPSHOT: { indexes: string[] } = JSON.parse(
  readFileSync(join(ROOT, 'tests/unit/schema-drift-snapshot-2255.json'), 'utf8'),
);

function declaredIndexNames(): Set<string> {
  const out = new Set<string>();
  for (const exp of Object.values(schema)) {
    if (!(exp instanceof PgTable)) continue;
    const cfg = getTableConfig(exp as never);
    for (const c of cfg.columns) {
      const col = c as never as { isUnique?: boolean; uniqueName?: string };
      if (col.isUnique && col.uniqueName) out.add(col.uniqueName);
    }
    for (const i of cfg.indexes) {
      const name = (i as never as { config: { name?: string } }).config.name;
      if (name) out.add(name);
    }
    for (const u of cfg.uniqueConstraints) {
      const name = (u as never as { config: { name?: string } }).config.name;
      if (name) out.add(name);
    }
  }
  return out;
}

describe('0116_drop_duplicate_indexes migration shape (#2264)', () => {
  const sql = readFileSync(UP, 'utf8');

  it('drops exactly the 20 duplicate members — nothing else', () => {
    const drops = [...sql.matchAll(/DROP INDEX IF EXISTS "public"\."([a-z0-9_]+)";/g)].map((m) => m[1]);
    expect([...drops].sort()).toEqual([...DROPPED].sort());
    expect(drops.length).toBe(20);
  });

  it('has no non-DROP statements (read-only on data, no CREATE sneaked in)', () => {
    const code = sql
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter(Boolean);
    expect(code.every((stmt) => /^DROP INDEX IF EXISTS "public"\."[a-z0-9_]+";$/i.test(stmt.replace(/\s+/g, ' ')))).toBe(true);
    expect(code.length).toBe(20);
  });

  it('down migration recreates exactly the same 20 indexes', () => {
    const down = readFileSync(DOWN, 'utf8');
    const creates = [...down.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect([...creates].sort()).toEqual([...DROPPED].sort());
    // predicate-carrying member must keep its WHERE clause
    expect(down).toMatch(/idx_webhook_queue_next_retry[^\n]*WHERE status = 'pending'/);
  });

  it('journal lists 0116 and the chain stays intact', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0116_drop_duplicate_indexes');
    expect(entry, '0116 missing from journal').toBeDefined();
    expect(entry.idx).toBe(116);
    // position-independent: later migrations may legitimately follow 0116
    const out = execFileSync('node', ['scripts/check-migration-chain.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('OK');
  });
});

describe('schema no longer declares the dropped duplicates (#2264)', () => {
  it('no dropped name is declared via getTableConfig', () => {
    const declared = declaredIndexNames();
    const stillDeclared = DROPPED.filter((n) => declared.has(n));
    expect(stillDeclared).toEqual([]);
  });

  it('no dropped name survives anywhere under drizzle/schema/** (incl. registry metadata)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(ROOT, 'drizzle/schema'));
    const hits = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return DROPPED.some((n) => text.includes(`'${n}'`));
    });
    expect(hits).toEqual([]);
  });

  it('every kept member of every pair is still declared', () => {
    const declared = declaredIndexNames();
    const missing = Object.values(PAIRS).filter((keep) => !declared.has(keep));
    expect(missing).toEqual([]);
  });
});

describe('DB snapshot reflects the drops (#2264)', () => {
  it('snapshot contains none of the 20 dropped indexes', () => {
    const live = new Set(SNAPSHOT.indexes);
    expect(DROPPED.filter((n) => live.has(n))).toEqual([]);
  });

  it('snapshot still contains every kept member', () => {
    const live = new Set(SNAPSHOT.indexes);
    expect(Object.values(PAIRS).filter((keep) => !live.has(keep))).toEqual([]);
  });

  it('#2255 duplicate allowlist is emptied — its members only existed as duplicates', () => {
    const guard = readFileSync(join(ROOT, 'tests/unit/schema-drift-guard-2255.test.ts'), 'utf8');
    expect(guard).toMatch(/const KNOWN_REDUNDANT_DUPLICATE_INDEXES: Record<string, string> = \{\s*\};/);
  });
});
