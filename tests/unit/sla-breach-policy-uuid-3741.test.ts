/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3741 — sla_breaches.policy_id is a UUID column. The cron used to write the
 * policy NAME there, so every insert failed and no breach was ever recorded
 * or notified; the run still reported ok:true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { CronTenantSweep } from '@/lib/cron/tenant-scope';

const TENANT = '11111111-1111-4111-8111-111111111111';
const POLICY_ID = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/auth/cron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/cron')>()),
  verifyCronSecret: vi.fn(async () => true),
}));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true })),
  releaseLock: vi.fn(async () => {}),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn(() => NextResponse.json({ error: 'Internal error' }, { status: 500 })),
}));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => true) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_context: string, body: (tenantId: string) => Promise<void>) => {
    await body(TENANT);
    return { visited: 1, skipped: [], failed: [] } as CronTenantSweep;
  },
}));

const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
let insertBreachFails = false;
let policyRows: Array<Record<string, unknown>> = [];

vi.mock('@/drizzle/db', () => {
  function tableName(source: unknown): string {
    return String((source as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')] ?? '');
  }
  const ticket = {
    id: 'ticket-1', tenantId: TENANT, subject: 'SLA test', priority: 'medium',
    assignedTo: 'user-1', createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    firstResponseAt: null, resolvedAt: null, status: 'open',
  };
  return {
    db: {
      select: () => {
        const chain: Record<string, unknown> = {};
        let table = '';
        chain.from = (s: unknown) => { table = tableName(s); return chain; };
        chain.where = () => chain;
        chain.orderBy = () => chain;
        chain.limit = () => chain;
        chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(table === 'support_tickets' ? [ticket] : []).then(resolve, reject);
        return chain;
      },
      insert: (source: unknown) => ({
        values: (values: Record<string, unknown>) => {
          const table = tableName(source);
          inserted.push({ table, values });
          if (table === 'sla_policies') {
            return { returning: () => Promise.resolve([{ id: POLICY_ID }]) };
          }
          return insertBreachFails
            ? Promise.reject(new Error('22P02 invalid input syntax for type uuid'))
            : Promise.resolve(undefined);
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      query: { slaPolicies: { findMany: async () => policyRows } },
    },
  };
});

async function runCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/sla-check/route');
  const res = await POST({ headers: new Headers({ 'x-cron-secret': 's' }) } as never);
  return await res.json() as Record<string, unknown>;
}

beforeEach(() => {
  inserted.length = 0;
  insertBreachFails = false;
  policyRows = [];
});

describe('#3741 SLA breach policy id', () => {
  it('creates a default policy and writes its UUID, never the policy name', async () => {
    const body = await runCron();
    const breach = inserted.find(i => i.table === 'sla_breaches');
    expect(breach).toBeDefined();
    expect(breach!.values['policyId']).toBe(POLICY_ID);
    expect(breach!.values['policyId']).not.toBe('default-medium');
    expect(inserted.some(i => i.table === 'sla_policies')).toBe(true);
    expect(body['new_breaches']).toBe(1);
    expect(body['ok']).toBe(true);
  });

  it('uses the configured policy id when one exists, with no default insert', async () => {
    policyRows = [{
      id: POLICY_ID, tenantId: TENANT, priority: 'medium', name: 'Standard Support',
      responseTimeMinutes: 60, resolutionTimeMinutes: 120, escalationRules: [],
    }];
    await runCron();
    expect(inserted.some(i => i.table === 'sla_policies')).toBe(false);
    expect(inserted.find(i => i.table === 'sla_breaches')!.values['policyId']).toBe(POLICY_ID);
  });

  it('fails the run when a breach insert fails', async () => {
    insertBreachFails = true;
    const body = await runCron();
    expect(body['unrecorded_breaches']).toBe(1);
    expect(body['ok']).toBe(false);
  });
});
