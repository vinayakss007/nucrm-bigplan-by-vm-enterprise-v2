/**
 * #3246 step 3 — `/api/auth/sso` had no way to answer either.
 *
 * `sso_providers` is FORCE-RLS with one arm, `tenant_isolation`, keyed on
 * `app.current_tenant`. Both halves of the SSO handoff are anonymous (`proxy.ts:216`) and
 * both read `sso_providers` before anyone is authenticated — `start` by the caller's email
 * DOMAIN, `callback` by the provider id in the signed state cookie. `tenant_id` is NOT NULL
 * and the GUC is pinned to '' on every checkout, so each read matched zero rows: `start`
 * answered 404 "No SSO provider is configured for <domain>" and `callback` bounced a user
 * the IdP had just authenticated back to the login page.
 *
 * Migration 0140 adds the two narrow SELECT arms and `lib/db/sso-lookup-context.ts` names
 * their GUCs. These tests pin the ways that can quietly stop being true: an arm wider than
 * the read it exists for, a claim that chooses nothing (0134's boolean mistake), the GUCs
 * missing from a reset list (#2446), and either route calling the old bare-`db` shape again.
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
const PROVIDER = '7c1d9a43-2b6e-4d0f-8a51-3f9c6e2b8d14';

const UP = 'drizzle/migrations/0140_pre_auth_sso_provider_lookup.sql';
const DOWN = 'drizzle/migrations/0140_pre_auth_sso_provider_lookup.down.sql';
const START = 'app/api/auth/sso/start/route.ts';
const CALLBACK = 'app/api/auth/sso/callback/route.ts';

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

describe('0140 installs two arms and nothing broader', () => {
  const body = read(UP);
  const down = read(DOWN);
  const [block] = body.split('DO $$').slice(1);
  const statements = block.split('CREATE POLICY').slice(1);
  const armNamed = (name: string) => statements.find((s) => s.trimStart().startsWith(`"${name}"`)) ?? '';
  const domainArm = armNamed('sso_providers_domain_lookup_read');
  const idArm = armNamed('sso_providers_id_lookup_read');

  it('is journal-registered at idx 140 and re-runnable', () => {
    const journal = JSON.parse(read('drizzle/migrations/meta/_journal.json'));
    const entry = journal.entries.filter((e: { tag: string }) => e.tag === '0140_pre_auth_sso_provider_lookup');
    expect(entry).toHaveLength(1);
    expect(entry[0]!.idx).toBe(140);
    for (const name of ['sso_providers_domain_lookup_read', 'sso_providers_id_lookup_read']) {
      expect(body).toMatch(new RegExp(`DROP POLICY IF EXISTS "${name}" ON "sso_providers"`));
      expect(down).toMatch(new RegExp(`DROP POLICY IF EXISTS "${name}" ON "sso_providers"`));
    }
    expect(down).not.toMatch(/CREATE POLICY/);
  });

  it('is SELECT-only, on sso_providers, and creates exactly two policies', () => {
    expect([...block.matchAll(/CREATE POLICY/g)]).toHaveLength(2);
    expect([...block.matchAll(/CREATE POLICY "[^"]+" ON "sso_providers"/g)]).toHaveLength(2);
    expect([...block.matchAll(/FOR SELECT/g)]).toHaveLength(2);
    for (const cmd of ['FOR INSERT', 'FOR UPDATE', 'FOR DELETE', 'FOR ALL']) {
      expect(block, `a write arm here would let an anonymous handoff mutate ${cmd.slice(4)}`).not.toMatch(new RegExp(cmd));
    }
    expect(body, 'the session write is fixed by naming the tenant, not by a grant').not.toMatch(/CREATE POLICY[^;]*sso_sessions/);
  });

  it('narrows the domain arm by VALUE, the way 0136–0139 do, not by a boolean the query can outwalk', () => {
    // 0134's `app.auth_lookup = 'true'` is the mistake: a claim that only says "a lookup is
    // happening" lets the statement's own WHERE choose the row.
    expect(domainArm).toContain(`? NULLIF(current_setting('app.sso_lookup_domain', true), '')`);
    expect(domainArm).not.toMatch(/= 'true'/);
    expect(domainArm).toMatch(/"deleted_at" IS NULL/);
    expect(domainArm).toMatch(/"provider_type" = 'oidc'/);
    expect(domainArm).toMatch(/"is_active"/);
  });

  it('keys the id arm on the primary key and leaves isActive to the route', () => {
    expect(idArm).toMatch(/"id"\s*=\s*\(NULLIF\(current_setting\('app\.sso_provider_id',\s*true\),\s*''\)\)::uuid/);
    expect(idArm).toMatch(/"deleted_at" IS NULL/);
    // callback/route.ts answers "no longer available" from the row it read, so freezing
    // is_active here would move a decision the route already makes correctly.
    expect(idArm).not.toMatch(/"is_active"/);
  });

  it('fails closed with no claim, and never names a tenant', () => {
    for (const args of [...block.matchAll(/current_setting\(([^)]*)\)/g)].map((m) => m[1] ?? '')) {
      expect(args, 'missing_ok must be passed (#2438)').toMatch(/,\s*true/);
    }
    for ( const predicate of [domainArm.split('USING (')[1], idArm.split('USING (')[1]]) {
      const [, only] = predicate ?? ['', ''];
      expect(only!.split(';')[0], 'a tenant disjunct would widen past one provider').not.toMatch(/tenant_id/);
    }
    expect(body).not.toMatch(/DROP POLICY IF EXISTS "tenant_isolation"/);
  });
});

describe('the lookup helpers set exactly what the policies read', () => {
  it('claims the domain in one statement, normalized', async () => {
    const { setSsoDomainLookupContext } = await import('@/lib/db/sso-lookup-context');
    await setSsoDomainLookupContext(fakeTx() as never, ' ACME.example ');
    expect(stmts(), 'PP-028: one round trip per context change').toHaveLength(1);
    expect(stmts()[0]!.sql).toMatch(/set_config\(\$1, \$2, true\)/);
    expect(stmts()[0]!.params).toEqual(['app.sso_lookup_domain', 'acme.example']);
  });

  it('refuses a claim that cannot name a row instead of opening an empty context', async () => {
    const { setSsoDomainLookupContext } = await import('@/lib/db/sso-lookup-context');
    for (const bad of ['', '   ', 'not@here.example', 'a b.example', `x${'y'.repeat(253)}.example`]) {
      await expect(setSsoDomainLookupContext(fakeTx() as never, bad), bad).rejects.toThrow(/not a hostname/);
    }
    expect(stmts(), 'a refused claim must not reach the database at all').toEqual([]);
  });

  it('refuses a provider id that cannot be cast instead of handing Postgres a 22P02', async () => {
    const { setSsoProviderLookupContext } = await import('@/lib/db/sso-lookup-context');
    await expect(setSsoProviderLookupContext(fakeTx() as never, '')).rejects.toThrow(/empty providerId/);
    await expect(setSsoProviderLookupContext(fakeTx() as never, 'ACME-IDP-0001')).rejects.toThrow(/not a uuid/);
    expect(stmts()).toEqual([]);
  });

  it('opens a transaction, claims, then hands the callback the bound handle', async () => {
    const { withSsoDomainLookupContext, withSsoProviderLookupContext } = await import('@/lib/db/sso-lookup-context');
    expect(await withSsoDomainLookupContext('acme.example', async () => 'domain-done')).toBe('domain-done');
    expect(stmts()[0]!.sql).toBe('<BEGIN>');
    expect(stmts()[1]!.params).toEqual(['app.sso_lookup_domain', 'acme.example']);
    H.calls = [];
    expect(await withSsoProviderLookupContext(PROVIDER, async () => 'id-done')).toBe('id-done');
    expect(stmts()[0]!.sql).toBe('<BEGIN>');
    expect(stmts()[1]!.params).toEqual(['app.sso_provider_id', PROVIDER]);
  });
});

describe('#2446 — both new GUCs are on both reset lists', () => {
  const resetLine = (file: string) => {
    const line = read(file).split('\n').find((l) => l.includes("SELECT set_config('app.current_tenant'"));
    if (!line) throw new Error(`${file} no longer carries a checkout reset`);
    return [...line.matchAll(/set_config\('([^']+)', '([^']*)'/g)].map((m) => ({ guc: m[1] ?? '', to: m[2] }));
  };

  it('the pool release reset and the pinned-connection teardown reset both name them, cleared to empty', () => {
    for (const file of ['lib/db/pool.ts', 'lib/db/request-connection.ts']) {
      const list = resetLine(file);
      for (const guc of ['app.sso_lookup_domain', 'app.sso_provider_id']) {
        expect(list.find((p) => p.guc === guc)?.to, `${file} ${guc}`).toBe('');
      }
      expect(list.length, file).toBe(17);
    }
    expect(resetLine('lib/db/pool.ts').map((p) => p.guc)).toEqual(resetLine('lib/db/request-connection.ts').map((p) => p.guc));
  });

  it('the migration, the module and the reset lists agree on both strings', async () => {
    const { SSO_LOOKUP_DOMAIN_GUC, SSO_PROVIDER_ID_GUC } = await import('@/lib/db/sso-lookup-context');
    expect(SSO_LOOKUP_DOMAIN_GUC).toBe('app.sso_lookup_domain');
    expect(SSO_PROVIDER_ID_GUC).toBe('app.sso_provider_id');
    expect(read(UP)).toContain(`current_setting('${SSO_LOOKUP_DOMAIN_GUC}'`);
    expect(read(UP)).toContain(`current_setting('${SSO_PROVIDER_ID_GUC}'`);
    for (const guc of [SSO_LOOKUP_DOMAIN_GUC, SSO_PROVIDER_ID_GUC]) {
      expect(resetLine('lib/db/pool.ts').map((p) => p.guc), guc).toContain(guc);
    }
  });
});

describe('both routes read through a claim and write through a named tenant', () => {
  const start = read(START);
  const callback = read(CALLBACK);

  it('start claims the domain and queries on that handle', () => {
    expect(start).toMatch(/withSsoDomainLookupContext\(domain,/);
    expect(start).toMatch(/\(tx\) => tx\s*\n\s*\.select\(/);
    expect(start).not.toMatch(/\bdb\s*\n\s*\.select\(/);
  });

  it('callback claims the provider id, and keeps the lookup out of the IdP round trip', () => {
    expect(callback).toMatch(/withSsoProviderLookupContext\(stateCookie\.providerId,/);
    expect(callback).toMatch(/\(tx\) => tx\s*\n\s*\.select\(/);
    expect(callback).not.toMatch(/\bdb\s*\n\s*\.select\(/);
    const lookupAt = callback.indexOf('withSsoProviderLookupContext(');
    const exchange = callback.indexOf('exchangeAndVerify(');
    expect(lookupAt).toBeGreaterThan(-1);
    expect(lookupAt, 'a slow IdP must not hold a pooled connection open').toBeLessThan(exchange);
  });

  it('the session block names the tenant too, because sso_sessions has only tenant_isolation', () => {
    expect(callback).toMatch(/withTenantContext\(provider\.tenantId, userId, async \(tx\) =>/);
    expect(callback, 'a user-only context raises 42501 on the sso_sessions insert').not.toMatch(/withUserContext\(/);
    expect(callback).toMatch(/tx\.insert\(ssoSessions\)/);
    expect(callback).toMatch(/tx\.insert\(sessions\)/);
  });

  it('neither route imports the bare pool any more', () => {
    for (const [name, src] of [['start', start], ['callback', callback]]) {
      expect(src, `${name} re-imports the pool`).not.toMatch(/from '@\/drizzle\/db'/);
    }
  });

  it('the guard knows both helpers and no longer excuses the directory', async () => {
    const { CONTEXT_HELPERS, SCOPE_DEFERRALS } = await import('../../scripts/check-portal-rls-context.mts');
    expect(CONTEXT_HELPERS).toContain('withSsoDomainLookupContext');
    expect(CONTEXT_HELPERS).toContain('withSsoProviderLookupContext');
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).not.toContain('app/api/auth/sso');
  });
});
