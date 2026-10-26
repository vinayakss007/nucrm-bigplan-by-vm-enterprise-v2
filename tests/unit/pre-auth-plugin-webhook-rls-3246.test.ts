/**
 * #3246 step 2 — `POST /api/tenant/plugins/webhook/[id]` had no way to answer.
 *
 * `custom_plugins` is FORCE-RLS with one arm, `tenant_isolation`, keyed on
 * `app.current_tenant`. The route is anonymous (`proxy.ts` keeps it out of the session wall
 * because the URL and the HMAC are the authentication), so `app.current_tenant` is '' on the
 * read that fetches the row carrying the secret. `NULLIF('', …)` is NULL and
 * `custom_plugins.tenant_id` is NOT NULL, so both disjuncts fail and the lookup returned no
 * row for any plugin: 404 "Plugin", before `route.ts:104` could check a signature.
 *
 * Migration 0139 adds the narrow SELECT arm and `lib/db/plugin-webhook-context.ts` names its
 * GUC. These tests pin the three ways that can quietly stop being true: the arm wider than the
 * read it exists for, the GUC missing from a reset list (#2446), and the route calling the old
 * bare-`db` shape again.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const PLUGIN = '7c1d9a43-2b6e-4d0f-8a51-3f9c6e2b8d14';
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const UP = 'drizzle/migrations/0139_pre_auth_plugin_webhook_lookup.sql';
const DOWN = 'drizzle/migrations/0139_pre_auth_plugin_webhook_lookup.down.sql';
const ROUTE = 'app/api/tenant/plugins/webhook/[id]/route.ts';

interface Call { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({ calls: [] as unknown[] }));

function render(f: SQL): Call {
  const q = dialect.sqlToQuery(f);
  return { sql: q.sql, params: q.params };
}

const fakeTx = () => ({
  execute: (f: SQL) => {
    (H.calls as Call[]).push(render(f));
    return Promise.resolve([]);
  },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: SQL) => {
      (H.calls as Call[]).push(render(f));
      return Promise.resolve([]);
    },
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      (H.calls as Call[]).push({ sql: '<BEGIN>', params: [] });
      return cb(fakeTx());
    },
  },
}));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stmts = () => H.calls as Call[];

beforeEach(() => {
  H.calls = [];
});

describe('0139 installs one arm and nothing broader', () => {
  const body = read(UP);
  const down = read(DOWN);
  const [block] = body.split('DO $$').slice(1);

  it('is journal-registered at idx 139 and re-runnable', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json'));
    const entry = journal.entries.filter((e: { tag: string }) => e.tag === '0139_pre_auth_plugin_webhook_lookup');
    expect(entry).toHaveLength(1);
    expect(entry[0]!.idx).toBe(139);
    expect(body).toMatch(/DROP POLICY IF EXISTS "custom_plugins_webhook_lookup_read" ON "custom_plugins"/);
    expect(down).toMatch(/DROP POLICY IF EXISTS "custom_plugins_webhook_lookup_read" ON "custom_plugins"/);
    expect(down).not.toMatch(/CREATE POLICY/);
  });

  it('is SELECT-only, on custom_plugins, and creates exactly one policy', () => {
    expect([...block.matchAll(/CREATE POLICY/g)]).toHaveLength(1);
    expect(block).toMatch(/ON "custom_plugins"/);
    expect(block).toMatch(/FOR SELECT/);
    for (const cmd of ['FOR INSERT', 'FOR UPDATE', 'FOR DELETE', 'FOR ALL']) {
      expect(block, `a write arm here would let an anonymous callback mutate ${cmd.slice(4)}`).not.toMatch(new RegExp(cmd));
    }
    expect(body).not.toMatch(/CREATE POLICY[^;]*plugin_execution_logs/);
  });

  it('keys on the claim GUC, fails closed without it, and freezes the tombstone', () => {
    expect(block).toMatch(/current_setting\('app\.plugin_webhook_id',\s*true\)/);
    expect(block).toMatch(/NULLIF\(current_setting\('app\.plugin_webhook_id',\s*true\),\s*''\)/);
    expect(block).toMatch(/deleted_at IS NULL/);
    for (const args of [...block.matchAll(/current_setting\(([^)]*)\)/g)].map((m) => m[1] ?? '')) {
      expect(args, 'missing_ok must be passed (#2438)').toMatch(/,\s*true/);
    }
  });

  it('names no tenant, so the arm cannot widen past one row by primary key', () => {
    const [, predicate] = block.split('USING (');
    expect(predicate!.split(';')[0]).not.toMatch(/tenant_id/);
    expect(predicate!.split(';')[0]).toMatch(/"id"\s*=/);
    expect(body).not.toMatch(/DROP POLICY IF EXISTS "tenant_isolation"/);
  });
});

describe('the lookup helper sets exactly what the policy reads', () => {
  it('opens the claim in one statement, naming the plugin id', async () => {
    const { setPluginWebhookLookupContext } = await import('@/lib/db/plugin-webhook-context');
    await setPluginWebhookLookupContext(fakeTx() as never, PLUGIN);
    expect(stmts()).toHaveLength(1);
    const [call] = stmts();
    expect(call!.sql).toMatch(/set_config\(\$1, \$2, true\)/);
    expect(call!.params).toEqual(['app.plugin_webhook_id', PLUGIN]);
  });

  it('refuses an id that cannot be cast instead of handing Postgres a 22P02', async () => {
    const { setPluginWebhookLookupContext } = await import('@/lib/db/plugin-webhook-context');
    await expect(setPluginWebhookLookupContext(fakeTx() as never, '')).rejects.toThrow(/empty pluginId/);
    await expect(setPluginWebhookLookupContext(fakeTx() as never, 'ACME-PL-0001')).rejects.toThrow(/not a uuid/);
    expect(stmts(), 'a refused claim must not reach the database at all').toEqual([]);
  });

  it('the handover closes the claim, names the tenant and the nil-uuid user, in one statement', async () => {
    const { setPluginWebhookTenantContext } = await import('@/lib/db/plugin-webhook-context');
    const { NO_USER_SENTINEL } = await import('@/lib/db/rls');
    await setPluginWebhookTenantContext(fakeTx() as never, TENANT);
    expect(stmts(), 'PP-028: one round trip per context change').toHaveLength(1);
    const [call] = stmts();
    expect(call!.sql).toMatch(/set_config\(\$1, '', true\),\s*set_config\('app\.current_tenant', \$2, true\),\s*set_config\('app\.current_user', \$3, true\)/);
    expect(call!.params).toEqual(['app.plugin_webhook_id', TENANT, NO_USER_SENTINEL]);
  });

  it('wraps a transaction for the lookup, and hands the callback the bound handle', async () => {
    const { withPluginWebhookLookupContext } = await import('@/lib/db/plugin-webhook-context');
    const seen = await withPluginWebhookLookupContext(PLUGIN, async () => 'done');
    expect(seen).toBe('done');
    expect(stmts()[0]!.sql).toBe('<BEGIN>');
    expect(stmts()[1]!.params).toEqual(['app.plugin_webhook_id', PLUGIN]);
  });
});

describe('#2446 — the new GUC is on both reset lists, spelled as the module spells it', () => {
  const resetLine = (file: string) => {
    const line = read(file).split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
    if (!line) throw new Error(`${file} no longer carries a checkout reset`);
    return [...line.matchAll(/set_config\('([^']+)', '([^']*)'/g)].map((m) => ({ guc: m[1] ?? '', to: m[2] }));
  };

  it('the pool release reset and the pinned-connection teardown reset both name it, cleared to empty', () => {
    for (const file of ['lib/db/pool.ts', 'lib/db/request-connection.ts']) {
      const list = resetLine(file);
      expect(list.find((p) => p.guc === 'app.plugin_webhook_id')?.to, file).toBe('');
      expect(list.length, file).toBe(15);
    }
    expect(resetLine('lib/db/pool.ts').map((p) => p.guc)).toEqual(resetLine('lib/db/request-connection.ts').map((p) => p.guc));
  });

  it('the migration, the helper and the reset lists agree on the string', async () => {
    const { PLUGIN_WEBHOOK_GUC } = await import('@/lib/db/plugin-webhook-context');
    expect(PLUGIN_WEBHOOK_GUC).toBe('app.plugin_webhook_id');
    expect(read(UP)).toContain(`current_setting('${PLUGIN_WEBHOOK_GUC}'`);
    expect(resetLine('lib/db/pool.ts').map((p) => p.guc)).toContain(PLUGIN_WEBHOOK_GUC);
  });
});

describe('the route reads through the claim and writes through the tenant', () => {
  const src = read(ROUTE);

  it('opens the lookup context the guard recognises, and queries on that handle', () => {
    expect(src).toMatch(/withPluginWebhookLookupContext\(/);
    expect(src).toMatch(/await tx\s*\n\s*\.select\(/);
    expect(src).not.toMatch(/\bdb\s*\n\s*\.select\(/);
  });

  it('answers a non-uuid path id as a missing plugin, before opening any context', () => {
    const guard = src.search(/if \(!isUuid\(id\)\) \{\s*return notFound\('Plugin'\);/);
    expect(guard, 'a malformed id must not reach Postgres as a 22P02').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf('withPluginWebhookLookupContext('));
  });

  it('names the tenant only after the signature has been verified', () => {
    const verified = src.indexOf('verifyWebhookSignature(');
    const handover = src.indexOf('setPluginWebhookTenantContext(');
    expect(verified).toBeGreaterThan(-1);
    expect(handover).toBeGreaterThan(verified);
  });

  it('passes the bound handle to the log write, which is the point of the handover', async () => {
    expect(src).toMatch(/handleInboundWebhook\(tx,/);
    const handler = read('lib/plugins/webhook-handler.ts');
    expect(handler).toMatch(/handleInboundWebhook\(\s*tx: RlsTransaction,/);
    expect(handler).toMatch(/await tx\.insert\(pluginExecutionLogs\)/);
    expect(handler, 'the bare pool must not come back into this file').not.toMatch(/from '@\/drizzle\/db'/);
  });

  it('the guard knows the helper and no longer excuses the directory', async () => {
    const { CONTEXT_HELPERS, SCOPE_DEFERRALS } = await import('../../scripts/check-portal-rls-context.mts');
    expect(CONTEXT_HELPERS).toContain('withPluginWebhookLookupContext');
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).not.toContain('app/api/tenant/plugins/webhook');
  });
});
