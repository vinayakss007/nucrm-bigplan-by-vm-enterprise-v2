/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  analyzeSource,
  boundHandles,
  findReads,
  loadTenantTables,
  maskComments,
  MIN_SCANNED_FILES,
  MIN_TABLE_READS,
  MIN_TENANT_KEYED_TABLES,
  run,
  schemaReExports,
  DEFAULT_TARGETS,
  tenantKeyedTables,
  verifyEntry,
  type BaselineEntry,
  type TenantTable,
} from '../../scripts/check-portal-rls-context.mts';

/**
 * #2446 criterion 4: the portal routes must not read a tenant-policyed table
 * outside a context-establishing call.
 *
 * A guard like this fails in exactly one direction — silently. If the schema
 * stops loading, if the handle regex stops matching, if the walk finds no
 * files, it prints "OK" for a portal that 403s every customer. So every case
 * here is either a planted violation that MUST be named with its file:line, or
 * a known-good shape that must NOT be, and the fail-closed counts are asserted
 * on their own.
 */

const ROOT = join(import.meta.dirname!, '..', '..');

const invoices = pgTable('invoices', { id: uuid('id'), tenantId: uuid('tenant_id'), contactId: uuid('contact_id') });
const supportTickets = pgTable('support_tickets', { id: uuid('id'), tenantId: uuid('tenant_id'), portalToken: text('portal_token') });
const csatSurveys = pgTable('csat_surveys', { id: uuid('id'), tenantId: uuid('tenant_id'), token: text('token') });
// No tenant_id: nothing here needs a context, and a guard that flags it is a
// guard people learn to ignore.
const tenants = pgTable('tenants', { id: uuid('id'), name: text('name') });

const tables: Map<string, TenantTable> = tenantKeyedTables({ invoices, supportTickets, csatSurveys, tenants });

function analyze(rel: string, source: string, baseline: BaselineEntry[] = []) {
  return analyzeSource(rel, source, tables, baseline, ROOT);
}

function problems(rel: string, source: string, baseline: BaselineEntry[] = []): string[] {
  return analyze(rel, source, baseline).violations.map((v) => v.problem);
}

const LINE = (source: string, needle: string) => source.slice(0, source.indexOf(needle)).split('\n').length;

describe('the policyed set is derived from drizzle (#2446)', () => {
  it('takes tenant_id from the column, and ignores a table that has none', () => {
    expect([...tables.keys()].sort()).toEqual(['csatSurveys', 'invoices', 'supportTickets']);
    expect(tables.get('supportTickets')?.sql).toBe('support_tickets');
    expect(tables.get('tenants')).toBeUndefined();
  });

  it('derives the repository schema, and honours the index rename that keeps `documents` unambiguous', () => {
    const { star, explicit } = schemaReExports(ROOT);
    expect(star.has('documents')).toBe(true);
    expect(explicit.get('files')?.get('documents')).toBe('storageDocuments');
  });

  it('loads every tenant-keyed table, not a handful that survived a bad import', async () => {
    const real = await loadTenantTables(ROOT);
    expect(real.size).toBeGreaterThanOrEqual(MIN_TENANT_KEYED_TABLES);
    // The two names this issue turns on, plus the one the merged-map loader used
    // to lose: `documents` is shadowed by files.ts's export of the same name.
    for (const js of ['invoices', 'supportTickets', 'contacts', 'quotes', 'documents', 'storageDocuments']) {
      expect(real.has(js) ? js : `${js} MISSING`).toBe(js);
    }
    expect(real.get('documents')?.sql).toBe('documents');
    expect(real.get('storageDocuments')?.sql).toBe('storage_documents');
  }, 30_000);
});

describe('what counts as a transaction handle', () => {
  it('binds the callback parameter of a context call, annotated return type or not', () => {
    expect([...boundHandles(`withTenantContext(t, u, (tx) => {})`).names].sort())
      .toEqual(['tx']);
    expect(boundHandles('withTenantContext(a, b, async (tx): Promise<X> => {})').names.has('tx')).toBe(true);
    expect(boundHandles('withPortalLookupContext({ accessToken }, async (tx) => {})').names.has('tx')).toBe(true);
  });

  it('binds a helper parameter declared as an RlsTransaction, and records it as handle-first', () => {
    const src = 'async function writeReply(\n  tx: RlsTransaction,\n  ticketId: string,\n): Promise<void> {}';
    const bound = boundHandles(src);
    expect(bound.names.has('tx')).toBe(true);
    expect(bound.handleFirstFns).toContain('writeReply');
  });

  it('does not bind a db.transaction() handle — it carries no tenant GUCs either', () => {
    expect(boundHandles('db.transaction(async (tx) => { await tx.update(quotes); })').names.has('tx')).toBe(false);
  });
});

describe('violations the guard must name (#2446)', () => {
  it('reports a read of a policyed table on the bare pool', () => {
    const src = [
      'export async function GET() {',
      '  const rows = await db.select({ id: invoices.id }).from(invoices);',
      '  return rows;',
      '}',
    ].join('\n');
    const v = analyze('app/api/public/x/route.ts', src).violations;
    expect(v).toHaveLength(1);
    expect(v[0].table).toBe('invoices');
    expect(v[0].line).toBe(LINE(src, 'db.select'));
    expect(v[0].problem).toContain('bare pool');
  });

  it('reports `db.*` INSIDE a withTenantContext callback — the context is on the tx, not the pool', () => {
    const src = [
      'await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) => {',
      '  const rows = await db.select({ id: invoices.id }).from(invoices);',
      '  return rows;',
      '});',
    ].join('\n');
    expect(problems('app/api/public/x/route.ts', src).join('\n')).toContain('bare pool');
  });

  it('reports a read through a db.transaction() handle', () => {
    const src = 'await db.transaction(async (tx) => { await tx.update(invoices).set({ contactId: null }); });';
    expect(problems('app/api/public/x/route.ts', src).join('\n')).toContain('not bound by a context-establishing call');
  });

  it('reports a relational read through that handle too — the pool NAME is not what makes a read unbound (#2468)', () => {
    // QUERY_RE used to decide this with `\bdb\s*\.\s*query\b`, so an identical
    // statement became invisible the moment it moved from `db.query` onto a bare
    // `tx.query`. Measured on the offers route's `contacts` lookup after #2468 put
    // it in a context: the read was still found, but no longer classed as a query,
    // so it stopped being policed at all.
    const src = 'await db.transaction(async (tx) => { await tx.query.invoices.findFirst({ where: eq(invoices.id, id) }); });';
    expect(findReads(src, tables).filter((r) => r.isQuery)).toHaveLength(1);
    expect(problems('app/api/public/x/route.ts', src).join('\n')).toContain('not bound by a context-establishing call');
  });

  it('reports a statement that reads a policyed table with no handle it can name', () => {
    const src = 'const rows = await pool().select({ id: invoices.id }).from(invoices);';
    expect(problems('app/api/public/x/route.ts', src).join('\n')).toContain('hangs off nothing');
  });

  it('reports the pool handed to a function that promised a transaction handle', () => {
    const src = [
      'async function readStuff(tx: RlsTransaction, id: string) {',
      '  return tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, id));',
      '}',
      'const rows = await readStuff(db, id);',
    ].join('\n');
    const v = analyze('app/api/public/x/route.ts', src).violations;
    expect(v.map((x) => x.problem).join('\n')).toContain('readStuff(…) takes a transaction handle but is handed the bare pool');
    expect(v.map((x) => x.line)).toContain(LINE(src, 'readStuff(db'));
  });

  it('reports a route that resolves a portal identity and opens no context at all', () => {
    const src = [
      'const identity = await resolvePortalIdentity(request);',
      'const contact = await resolvePortalContact(identity);',
      'return NextResponse.json({ data: [] });',
    ].join('\n');
    expect(problems('app/api/public/y/route.ts', src).join('\n')).toContain('never calls a context-establishing helper');
  });

  it('accepts the same file once the work is inside a context and uses the callback handle', () => {
    const src = [
      'const identity = await resolvePortalIdentity(request);',
      'const contact = await resolvePortalContact(identity, tx);',
      'const rows = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, async (tx) =>',
      '  tx.select({ id: invoices.id }).from(invoices));',
    ].join('\n');
    expect(analyze('app/api/public/y/route.ts', src).violations).toEqual([]);
  });
});

describe('what the guard must NOT report', () => {
  it('ignores a table named in a comment — routes explain themselves in prose', () => {
    const src = [
      '// A bare db.select().from(invoices) here would lose the context (#2446).',
      'await withTenantContext(t, u, async (tx) => tx.select({ id: invoices.id }).from(invoices));',
    ].join('\n');
    expect(analyze('app/api/public/z/route.ts', src).violations).toEqual([]);
    expect(maskComments(src).slice(0, src.indexOf('\n')).trim()).toBe('');
  });

  it('ignores a column map that is not a query', () => {
    const src = 'const TICKET_PROJECTION = {\n  id: supportTickets.id,\n  status: supportTickets.status,\n};\n';
    expect(analyze('app/api/public/z/route.ts', src).violations).toEqual([]);
    // One finding per (statement, table): two columns of the same table in one
    // map is one gate to satisfy, not two.
    expect(findReads(src, tables)).toHaveLength(1);
  });

  it('ignores a non-tenant table read on the pool, and a query it belongs to', () => {
    const src = 'const t = await db.query.tenants.findFirst({ where: eq(tenants.id, id) });';
    expect(analyze('app/api/public/z/route.ts', src).violations).toEqual([]);
  });

  it('accepts the credential lookup in its own narrow context', () => {
    const src = [
      'const owner = await withPortalLookupContext({ accessToken: token }, async (tx) => {',
      '  const [row] = await tx.select({ tenantId: supportTickets.tenantId }).from(supportTickets)',
      '    .where(eq(supportTickets.portalToken, token)).limit(1);',
      '  return row ?? null;',
      '});',
    ].join('\n');
    expect(analyze('app/api/public/k/route.ts', src).violations).toEqual([]);
  });
});

describe('raw SQL reaches the same rule', () => {
  it('finds a policyed table named in a db.execute template', () => {
    const src = 'const rows = await db.execute(sql`SELECT id FROM csat_surveys WHERE token = ${token}`);';
    const v = analyze('app/api/public/raw/route.ts', src).violations;
    expect(v.map((x) => x.table)).toContain('csatSurveys');
    expect(v.map((x) => x.problem).join('\n')).toContain('bare pool');
  });

  it('does not invent a read from the word FROM in an error message', () => {
    const src = 'throw new Error("SELECT id FROM csat_surveys failed");';
    expect(analyze('app/api/public/raw/route.ts', src).violations).toEqual([]);
  });
});

describe('the baseline is re-verified, not trusted (#2446)', () => {
  const honest: BaselineEntry = {
    file: 'app/api/public/csat/[token]/route.ts',
    table: 'csatSurveys',
    reason: 'Deferred bearer-token surface: the route keys on csat_surveys.token so no tenant is known until the row is read, and that read is itself refused by the policy (#2468).',
    deferredTo: '#2468',
    pinnedBy: 'tests/unit/portal-rls-context-guard-2446.test.ts',
  };

  it('refuses a short reason, a non-issue deferral, and a test that does not name the table', () => {
    expect(verifyEntry({ ...honest, reason: 'deferred' }, ROOT)).toContain('at least 40 characters');
    expect(verifyEntry({ ...honest, deferredTo: 'later' }, ROOT)).toContain('must be the issue');
    expect(verifyEntry({ ...honest, deferredTo: 'https://x/1' }, ROOT)).toContain('must be the issue');
    expect(verifyEntry({ ...honest, pinnedBy: 'tests/unit/does-not-exist.ts' }, ROOT)).toContain('does not exist');
    expect(verifyEntry({ ...honest, pinnedBy: 'tests/unit/portal-auth.test.ts' }, ROOT)).toContain('does not mention');
    expect(verifyEntry(honest, ROOT)).toBeNull();
  });

  it('exempts exactly the statements it names, and nothing else', () => {
    const src = [
      'const a = await db.select({ id: csatSurveys.id }).from(csatSurveys);',
      'const b = await db.update(invoices).set({ contactId: null });',
    ].join('\n');
    const v = analyze('app/api/public/csat/[token]/route.ts', src, [honest]).violations;
    expect(v.map((x) => x.table)).toEqual(['invoices']);
  });

  it('still fails when the deferral itself has rotted', () => {
    const src = 'const a = await db.select({ id: csatSurveys.id }).from(csatSurveys);';
    const v = analyze('app/api/public/csat/[token]/route.ts', src, [{ ...honest, deferredTo: 'nope' }]).violations;
    expect(v[0].problem).toContain('must be the issue');
  });
});

describe('the walk is the portal surface, and it fails closed', () => {
  let repoTables: Map<string, TenantTable>;
  beforeAll(async () => {
    repoTables = await loadTenantTables(ROOT);
  }, 30_000);

  it('scans the real portal surface clean against the real baseline', async () => {
    const res = await run(DEFAULT_TARGETS, ROOT, { tables: repoTables });
    expect(res.files).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);
    expect(res.reads).toBeGreaterThanOrEqual(MIN_TABLE_READS);
    expect(res.violations).toEqual([]);
    expect(res.unused).toEqual([]);
  }, 60_000);

  it('walks 17 files because the surface is 14 public routes plus the three portal-auth files', async () => {
    const res = await run(['app/api/public', 'lib/portal-auth.ts', 'lib/portal-session.ts', 'app/api/tenant/portal/login'], ROOT, { tables: repoTables });
    expect(res.files).toBe(17);
    const again = await run(DEFAULT_TARGETS, ROOT, { tables: repoTables });
    expect(again.violations).toEqual([]);
  }, 60_000);

  it('throws rather than blessing everything when the schema or the walk goes missing', async () => {
    await expect(run([], ROOT, { tables: new Map(), baseline: [] })).rejects.toThrow(/derived only 0/);
    await expect(run(['app/api/nowhere'], ROOT, { tables: repoTables, baseline: [] })).rejects.toThrow(/walked 0 file/);
    // Targets that exist but yield no policyed read: the patterns broke. The fake
    // set is 120 tables wide so the schema check above cannot be what trips.
    const wide = new Map(Array.from({ length: 120 }, (_, i) => [`zzTable${i}`, { js: `zzTable${i}`, sql: `zz_table_${i}` }]));
    await expect(run(DEFAULT_TARGETS, ROOT, { tables: wide, baseline: [] })).rejects.toThrow(/found 0 tenant-keyed statement/);
  }, 60_000);
});

/**
 * #2446 filed these five files as deferred, and the baseline carried nine
 * entries saying so. #2468 fixed them, so this block is the SAME assertion with
 * the sign of the deferral reversed: what the guard used to have to be talked
 * out of, it now reports clean with `baseline: []` — while still SEING the
 * statements it used to flag. "Zero violations because the analyzer stopped
 * finding reads" is exactly the silent failure mode this file exists to catch,
 * so every case here pins the read set it is refusing to complain about.
 */
describe('the bearer-token surface #2446 deferred is bound, with no baseline (#2468)', () => {
  const fixed: Array<{ file: string; tables: string[] }> = [
    { file: 'app/api/public/csat/[token]/route.ts', tables: ['csatSurveys'] },
    { file: 'app/api/public/offers/[publicToken]/route.ts', tables: ['quotes', 'quoteLineItems', 'contacts'] },
    { file: 'app/api/public/offers/[publicToken]/accept/route.ts', tables: ['quotes', 'activities'] },
    { file: 'app/api/public/offers/[publicToken]/decline/route.ts', tables: ['quotes', 'activities'] },
  ];

  let repoTables: Map<string, TenantTable>;
  beforeAll(async () => {
    repoTables = await loadTenantTables(ROOT);
  }, 30_000);

  for (const { file, tables: expected } of fixed) {
    it(`${file}: every ${expected.join('/')} statement is read by the guard and bound by a context`, async () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const found = analyzeSource(file, src, repoTables, [], ROOT);
      expect(found.violations.map((v) => `${v.table}@${v.line}: ${v.problem}`)).toEqual([]);
      // Non-vacuity, two ways: the analyzer still finds these tables here…
      const read = findReads(src, repoTables).filter((r) => r.isQuery);
      expect([...new Set(read.map((r) => r.js))].sort()).toEqual(expect.arrayContaining(expected.slice().sort()));
      // …and none of them hangs off the bare pool any more.
      expect(read.filter((r) => r.handle === 'db').map((r) => `${r.js}@${r.line}`)).toEqual([]);
    }, 30_000);
  }

  it('the signing route reaches the database only through lib/esignature-internal.ts', async () => {
    // Its documents read is gone (#2468 folded the name into the gate that
    // already admitted the row, which is also what retired the
    // portal-softdelete-baseline entry for it). So this file has nothing left to
    // bind — and the proof of that is the pool never appearing in it at all.
    const src = readFileSync(join(ROOT, 'app/api/public/sign/[token]/route.ts'), 'utf8');
    expect(src).not.toMatch(/from '@\/drizzle\/db'/);
    expect(findReads(src, repoTables).filter((r) => r.isQuery && r.handle === 'db')).toEqual([]);

    // The reads moved to a file the guard does not walk, so run the walk over it
    // explicitly rather than claiming a coverage the guard does not have.
    const libFile = 'lib/esignature-internal.ts';
    const libSrc = readFileSync(join(ROOT, libFile), 'utf8');
    const lib = analyzeSource(libFile, libSrc, repoTables, [], ROOT);
    expect(lib.violations.map((v) => `${v.table}@${v.line}: ${v.problem}`)).toEqual([]);
    const libRead = findReads(libSrc, repoTables).filter((r) => r.isQuery);
    expect([...new Set(libRead.map((r) => r.js))].sort()).toEqual(
      expect.arrayContaining(['signingRequests', 'signingEvents', 'documents']),
    );
    expect(libRead.filter((r) => r.handle === 'db').map((r) => `${r.js}@${r.line}`)).toEqual([]);
  }, 30_000);

  it('the empty baseline is the state, not a conveniently short list', () => {
    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'scripts', 'portal-rls-context-baseline.json'), 'utf8'),
    ) as { entries: BaselineEntry[] };
    expect(baseline.entries).toEqual([]);
  });
});
