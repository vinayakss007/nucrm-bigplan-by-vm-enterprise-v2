/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2618 — field_permissions enforcement existed only on the deals handlers;
 * leads/contacts auxiliary paths (bulk, import, assign, convert, scan, export,
 * duplicates, history, contact-scoped lead lists) wrote and returned
 * restricted columns unchecked, and the entities' true wire synonyms
 * (`status`/`source`/`title`/`user_id`/`leadFirstName`) bypassed the alias
 * layer. Pins, in order of what silently regresses if the logic drifts:
 *   1. the alias extensions behave (read + write, per entity);
 *   2. the export lib honors `project` and drops restricted columns from the
 *      CSV header row (intersection, not data[0]);
 *   3. static wire-up: every route in the coverage map calls the right half
 *      of the enforcement layer, and the leads POST 409 no longer embeds a
 *      raw duplicate row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuthContext } from '@/lib/auth/middleware';

const ROOT = join(import.meta.dirname!, '..', '..');
const TENANT = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

const { mockDb } = vi.hoisted(() => ({ mockDb: { select: vi.fn() } }));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/queue', () => ({ addJob: vi.fn() }));

import {
  enforceFieldRead,
  enforceFieldWrite,
  __clearRoleIdCache,
  __clearFieldRestrictionsCache,
} from '@/lib/rbac/enforce';

// Same builder-queue harness as rbac-field-enforcement-2597.test.ts, extended
// with leftJoin because the export lib's queries chain through joins.
let queued: unknown[][] = [];
let call = 0;
function makeBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['from', 'where', 'orderBy', 'limit', 'leftJoin']) b[m] = chain;
  b['then'] = (res: (v: unknown) => unknown) => res(rows);
  return b;
}
function queue(...results: unknown[][]) {
  queued = results;
  call = 0;
  // #2619 gave enforce.ts two caches (role ids, and the restriction maps keyed
  // tenant:role:entity with a 60 s TTL). Both are module state, so a test that
  // re-queues new rows must invalidate them or it asserts the previous test's
  // map — which is exactly how the alias tests below failed once #2619 landed.
  __clearRoleIdCache();
  __clearFieldRestrictionsCache();
  mockDb.select.mockImplementation(() => {
    const rows = queued[call] ?? [];
    call += 1;
    return makeBuilder(rows);
  });
}

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1', tenantId: TENANT, roleSlug: 'rep',
    permissions: {}, isAdmin: false, isSuperAdmin: false, ...over,
  } as AuthContext;
}

beforeEach(() => {
  __clearRoleIdCache();
  __clearFieldRestrictionsCache();
  vi.resetModules();
});

describe('alias vocabulary — true synonyms only normalize cannot bridge (#2618)', () => {
  it('leads: a lead_status restriction strips the `status` body spelling on write', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'lead_status', accessLevel: 'none' }]);
    const { body, stripped } = await enforceFieldWrite(ctx(), 'leads', {
      status: 'qualified', first_name: 'Ada',
    });
    expect(body).toEqual({ first_name: 'Ada' });
    expect(stripped).toEqual(['status']);
  });

  it('leads: a lead_source restriction strips the `source` key on read AND write', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'lead_source', accessLevel: 'none' }]);
    const rows = await enforceFieldRead(ctx(), 'leads', [{ id: 'l1', source: 'website', score: 3 }]);
    expect(rows).toEqual([{ id: 'l1', score: 3 }]);
    queue([{ id: ROLE_ID }], [{ fieldName: 'lead_source', accessLevel: 'none' }]);
    const { stripped } = await enforceFieldWrite(ctx(), 'leads', { source: 'website' });
    expect(stripped).toEqual(['source']);
  });

  it('leads: a first_name restriction strips the leadFirstName join spelling (history leak)', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'first_name', accessLevel: 'none' }]);
    const rows = await enforceFieldRead(ctx(), 'leads', [{
      id: 'h1', leadFirstName: 'Ada', leadLastName: 'L', assignedAt: '2026-01-01',
    }]);
    // only first_name is configured — leadLastName proves the strip is per field.
    expect(rows).toEqual([{ id: 'h1', leadLastName: 'L', assignedAt: '2026-01-01' }]);
  });

  it('contacts: a job_title restriction strips `title` (PATCH) and jobTitle (detail row)', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'job_title', accessLevel: 'none' }]);
    const { stripped } = await enforceFieldWrite(ctx(), 'contacts', { title: 'CEO', email: 'a@x.io' });
    expect(stripped).toEqual(['title']);
    queue([{ id: ROLE_ID }], [{ fieldName: 'job_title', accessLevel: 'none' }]);
    const rows = await enforceFieldRead(ctx(), 'contacts', [{ id: 'c1', jobTitle: 'CEO' }]);
    expect(rows).toEqual([{ id: 'c1' }]);
  });

  it('contacts: a created_by restriction strips the user_id POST-response spelling', async () => {
    queue([{ id: ROLE_ID }], [{ fieldName: 'created_by', accessLevel: 'none' }]);
    const rows = await enforceFieldRead(ctx(), 'contacts', [{ id: 'c1', user_id: 'u9' }]);
    expect(rows).toEqual([{ id: 'c1' }]);
  });

  it('no-config roles stay untouched (fast path, default-open)', async () => {
    queue([{ id: ROLE_ID }], []);
    const body = { status: 'x', title: 'y' };
    const res = await enforceFieldWrite(ctx(), 'leads', body);
    expect(res).toEqual({ body, stripped: [] });
  });
});

describe('generateExportData project option (#2618 export leak)', () => {
  it('drops a restricted column from the CSV header AND every row', async () => {
    const { generateExportData } = await import('@/lib/export');
    const { enforceFieldRead } = await import('@/lib/rbac/enforce');
    const dataRows = [
      { first_name: 'Ada', last_name: 'L', email: 'a@x.io', phone: '1' },
      { first_name: 'Bob', last_name: 'B', email: 'b@x.io', phone: '2' },
    ];
    let selects = 0;
    mockDb.select.mockImplementation(() => {
      selects += 1;
      if (selects === 1) return makeBuilder(dataRows);          // export query
      if (selects === 2) return makeBuilder([{ id: ROLE_ID }]); // role lookup
      return makeBuilder([{ fieldName: 'email', accessLevel: 'none' }]); // perms
    });
    const csv = await generateExportData({
      tenantId: TENANT, userId: 'u1', entityType: 'contacts',
      project: (rows) => enforceFieldRead(ctx(), 'contacts', rows),
    });
    const header = csv.split('\n')[0];
    expect(header).toBe('first_name,last_name,phone');
    expect(csv).not.toContain('a@x.io');
  });

  it('without project the CSV is byte-identical to the pre-#2618 shape', async () => {
    const { generateExportData } = await import('@/lib/export');
    mockDb.select.mockImplementation(() => makeBuilder([{ first_name: 'Ada', email: 'a@x.io' }]));
    const csv = await generateExportData({ tenantId: TENANT, userId: 'u1', entityType: 'contacts' });
    expect(csv.split('\n')[0]).toBe('first_name,email');
  });
});

describe('static wire-up — the #2618 coverage map', () => {
  const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('bulk routes gate their action columns and reject with 403', () => {
    for (const rel of ['app/api/tenant/leads/bulk/route.ts', 'app/api/tenant/contacts/bulk/route.ts']) {
      const s = src(rel);
      expect(s, rel).toMatch(/BULK_WATCHED_FIELDS/);
      expect(s, rel).toMatch(/enforceFieldWrite\(/);
      expect(s, rel).toMatch(/status: 403/);
    }
    expect(src('app/api/tenant/leads/bulk/route.ts')).toMatch(/status: \['lead_status'\]/);
    expect(src('app/api/tenant/contacts/bulk/route.ts')).toMatch(/assign: \['assigned_to'\]/);
  });

  it('assign routes gate the assigned_to write (the action IS the field)', () => {
    expect(src('app/api/tenant/leads/[id]/assign/route.ts')).toMatch(/enforceFieldWrite\(ctx, 'leads', \{ assigned_to/);
    // leads/assign bulk-writes CONTACTS despite its path (legacy naming).
    expect(src('app/api/tenant/leads/assign/route.ts')).toMatch(/enforceFieldWrite\(ctx, 'contacts', \{ assigned_to/);
  });

  it('convert strips deal/assign body keys rather than 403 (conversion stays meaningful)', () => {
    const s = src('app/api/tenant/leads/[id]/convert/route.ts');
    expect(s).toMatch(/enforceFieldWrite\(ctx, 'deals'/);
    expect(s).toMatch(/enforceFieldWrite\(ctx, 'leads'/);
    expect(s).not.toMatch(/field_permissions restricts/);
  });

  it('CSV imports project mapped rows and report dropped keys per row', () => {
    expect(src('app/api/tenant/leads/import/route.ts')).toMatch(/role restrictions dropped/);
    expect(src('lib/import/contacts.ts')).toMatch(/fieldGate/);
    expect(src('app/api/tenant/contacts/import/route.ts')).toMatch(/enforceFieldWrite/);
    expect(src('app/api/tenant/contacts/import/route.ts')).toMatch(/fieldGate:/);
  });

  it('scan gates the insert payload, 403s a vanished required name, projects the response', () => {
    const s = src('app/api/tenant/contacts/scan/route.ts');
    expect(s).toMatch(/enforceFieldWrite/);
    expect(s).toMatch(/stripped\.includes\('first_name'\)/);
    expect(s).toMatch(/enforceFieldRead\(ctx, 'contacts', \[contact\]\)/);
    expect(s).toMatch(/\.\.\.gatedPayload/);
  });

  it('contacts export projects through enforceFieldRead; leads rows inside contacts/[id]/leads do too', () => {
    expect(src('app/api/tenant/contacts/export/route.ts')).toMatch(/project: \(data\) => enforceFieldRead\(ctx, 'contacts', data\)/);
    expect(src('app/api/tenant/contacts/[id]/leads/route.ts')).toMatch(/enforceFieldRead\(ctx, 'leads', data\)/);
    expect(src('app/api/tenant/contacts/duplicates/route.ts')).toMatch(/enforceFieldRead\(ctx, 'contacts'/);
    expect(src('app/api/tenant/leads/history/route.ts')).toMatch(/enforceFieldRead\(ctx, 'leads'/);
  });

  it('the leads POST 409 returns the duplicate id, not the whole row', () => {
    const s = src('app/api/tenant/leads/route.ts');
    expect(s).not.toMatch(/duplicate: existing/);
    expect(s).toMatch(/db\.select\(\{ id: leads\.id \}\)/);
  });
});
