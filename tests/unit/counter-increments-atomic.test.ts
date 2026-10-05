/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { findReadModifyWrites } from '../../scripts/check-atomic-counters.mjs';

const dialect = new PgDialect();
const render = (fragment: SQL): string => dialect.sqlToQuery(fragment).sql;
const paramsOf = (fragment: SQL): unknown[] => dialect.sqlToQuery(fragment).params;

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const VISITOR_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444';

interface UpsertConfig {
  target: unknown;
  set: Record<string, unknown>;
  where: unknown;
}

const harness = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserts: [] as UpsertConfig[],
  writes: [] as { set: Record<string, unknown>; where: unknown }[],
}));

function makeTx(): unknown {
  return {
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        harness.rows.push(row);
        return {
          onConflictDoUpdate: vi.fn((cfg: UpsertConfig) => {
            harness.upserts.push(cfg);
            return Promise.resolve();
          }),
          then: (resolve: (v: undefined) => void) => resolve(undefined),
        };
      }),
    })),
  };
}

function recordWrite(set: Record<string, unknown>) {
  return {
    where: vi.fn((clause: unknown) => {
      harness.writes.push({ set, where: clause });
      return Promise.resolve();
    }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ tenantId: TENANT_ID }]),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(recordWrite) })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  },
}));

vi.mock('@/lib/rate-limit-simple', () => ({
  checkPublicRateLimit: vi.fn(() => undefined),
}));

vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => ({
    visitorId: VISITOR_ID,
    fingerprintId: 'fp-1',
    url: '/pricing',
  })),
}));

async function trackOnce(): Promise<void> {
  const { POST } = await import('@/app/api/tenant/visitors/track/route');
  const request = new Request('http://localhost/api/tenant/visitors/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'pk-test' },
    body: JSON.stringify({ visitorId: VISITOR_ID, fingerprintId: 'fp-1', url: '/pricing' }),
  });
  await POST(request as never);
}

async function bumpViewCount(patch?: { viewed_at?: string }): Promise<void> {
  const { incrementOfferViewCount } = await import('@/lib/offers');
  await incrementOfferViewCount('quote-1', TENANT_ID, patch);
}

describe('#2344 visitor tracking upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.rows = [];
    harness.upserts = [];
  });

  it('collapses first-view and repeat-view into one upsert', async () => {
    await trackOnce();
    const visitorRow = harness.rows.find((r) => r['id'] === VISITOR_ID);
    expect(visitorRow).toBeDefined();
    expect(visitorRow!['tenantId']).toBe(TENANT_ID);
    expect(harness.upserts).toHaveLength(1);
  });

  it('increments in SQL, not from a JavaScript-side read', async () => {
    await trackOnce();
    const set = harness.upserts[0]!.set;
    expect(render(set['totalPageViews'] as SQL)).toContain('"total_page_views" + 1');
    expect(render(set['score'] as SQL)).toContain('"score" + ');
    expect(set['lastSeenAt']).toBeInstanceOf(Date);
  });

  it('keeps a tenant predicate on conflict, because visitorId is visitor-supplied', async () => {
    await trackOnce();
    const where = harness.upserts[0]!.where as SQL;
    expect(render(where)).toContain('"tenant_id"');
    expect(paramsOf(where)).toContain(TENANT_ID);
    expect(paramsOf(where)).not.toContain(OTHER_TENANT_ID);
  });
});

describe('#2344 offer view counter (jsonb)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.writes = [];
  });

  it('computes the next count inside the UPDATE, guarded against a non-numeric legacy value', async () => {
    await bumpViewCount();
    expect(harness.writes).toHaveLength(1);
    const sqlText = render(harness.writes[0]!.set['metadata'] as SQL);
    expect(sqlText).toContain("->>'viewed_count'");
    expect(sqlText).toContain("'^[0-9]+$'");
    expect(sqlText).toContain('ELSE 0');
    expect(sqlText).toContain('+ 1');
  });

  it('writes only the metadata.offer subtree, so sibling keys survive', async () => {
    await bumpViewCount();
    const sqlText = render(harness.writes[0]!.set['metadata'] as SQL);
    expect(sqlText).toContain('jsonb_set(');
    expect(sqlText).toContain("'{offer}'");
    expect(sqlText).toContain('||');
  });

  it('merges an extra patch without dropping the SQL-side increment', async () => {
    await bumpViewCount({ viewed_at: '2026-10-05T00:00:00.000Z' });
    const metadata = harness.writes[0]!.set['metadata'] as SQL;
    const sqlText = render(metadata);
    expect(sqlText).toContain('+ 1');
    expect(sqlText).toContain('||');
    expect(JSON.stringify(paramsOf(metadata))).toContain('viewed_at');

    const where = harness.writes[0]!.where as SQL;
    expect(render(where)).toContain('"tenant_id"');
    expect(paramsOf(where)).toContain(TENANT_ID);
  });
});

describe('#2344 atomic-counter ratchet', () => {
  const stale = [
    '            totalPageViews: (existing[0]!.totalPageViews ?? 0) + 1,',
    '            score: (existing[0]!.score ?? 0) + points,',
    '            formSubmissionsCount: (existingLead.formSubmissionsCount || 0) + 1,',
    '    await db.update(kbArticles).set({ views: (article.views || 0) + 1 }).where(x)',
    '            viewed_count: (meta.viewed_count ?? 0) + 1,',
    '          attempts: delivery.attempt + 1,',
  ];

  const acceptable = [
    '          totalPageViews: sql`${visitors.totalPageViews} + 1`,',
    '    await db.update(kbArticles).set({ views: sql`${kbArticles.views} + 1` }).where(x)',
    '          const failureCount = (Number(baseConfig[\'_failureCount\']) || 0) + 1;',
    '          score: points,',
    '          totalPageViews: 1,',
    '          fingerprintId: fingerprintId || visitorId,',
  ];

  it('flags every read-modify-write shape it exists to catch', () => {
    for (const line of stale) {
      expect(findReadModifyWrites(line).length, `expected to flag: ${line.trim()}`).toBe(1);
    }
  });

  it('leaves atomic writes, in-memory accumulators and plain literals alone', () => {
    for (const line of acceptable) {
      expect(findReadModifyWrites(line).length, `expected clean: ${line.trim()}`).toBe(0);
    }
  });
});
