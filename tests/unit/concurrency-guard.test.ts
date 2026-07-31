import { describe, it, expect } from 'vitest';
import { PgDialect, pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { concurrencyGuard, concurrencyGuardById, checkStaleUpdate } from '@/lib/api/concurrency';

// Mirrors the shape the real tables have: id + tenantId + updatedAt + soft delete.
const softDeleted = pgTable('widgets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name'),
  updatedAt: timestamp('updated_at'),
  deletedAt: timestamp('deleted_at'),
});

// Some tables carry no updatedAt at all (e.g. aiActivity).
const noUpdatedAt = pgTable('pings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
});

const dialect = new PgDialect();

/**
 * Minimal stand-in for the drizzle query builder, capturing the where clause so
 * the generated SQL can be asserted on without a database.
 */
function stubDb(rows: Array<{ updatedAt: Date | string }>) {
  const captured: { where?: SQL } = {};
  const db = {
    select() {
      return {
        from() {
          return {
            where(w: SQL) {
              captured.where = w;
              return { limit: async () => rows };
            },
          };
        },
      };
    },
  };
  return { db, captured };
}

const ID = '11111111-1111-1111-1111-111111111111';
const TENANT = '22222222-2222-2222-2222-222222222222';

describe('concurrencyGuard — soft-delete predicate', () => {
  it('filters deleted rows with IS NULL, not = NULL', async () => {
    // Regression: the predicate used eq(deletedAt, null), which drizzle emits as
    // `deleted_at = $n`. `x = NULL` is never true in SQL, so the lookup matched
    // nothing and every guarded update returned 404 instead of comparing
    // timestamps. 13 of the 14 routes using this overload were affected.
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { db, captured } = stubDb([{ updatedAt: when }]);

    await concurrencyGuard(db, softDeleted, ID, TENANT, when.toISOString());

    expect(captured.where).toBeDefined();
    const sql = dialect.sqlToQuery(captured.where!).sql;
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).not.toMatch(/"deleted_at"\s*=/);
  });

  it('still scopes by id and tenant', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { db, captured } = stubDb([{ updatedAt: when }]);

    await concurrencyGuard(db, softDeleted, ID, TENANT, when.toISOString());

    const sql = dialect.sqlToQuery(captured.where!).sql;
    expect(sql).toContain('"id" =');
    expect(sql).toContain('"tenant_id" =');
  });
});

describe('concurrencyGuard — outcomes', () => {
  it('passes when the timestamps match', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { db } = stubDb([{ updatedAt: when }]);

    const res = await concurrencyGuard(db, softDeleted, ID, TENANT, when.toISOString());

    expect(res).toBeNull();
  });

  it('409s when the row moved on', async () => {
    const { db } = stubDb([{ updatedAt: new Date('2026-01-02T00:00:00.000Z') }]);

    const res = await concurrencyGuard(db, softDeleted, ID, TENANT, '2026-01-01T00:00:00.000Z');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    await expect(res!.json()).resolves.toMatchObject({ error: expect.stringContaining('Stale data') });
  });

  it('404s when there is no such row', async () => {
    const { db } = stubDb([]);

    const res = await concurrencyGuard(db, softDeleted, ID, TENANT, '2026-01-01T00:00:00.000Z');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it('skips the check when no expectedUpdatedAt was sent', async () => {
    const { db, captured } = stubDb([]);

    const res = await concurrencyGuard(db, softDeleted, ID, TENANT, undefined);

    expect(res).toBeNull();
    expect(captured.where).toBeUndefined();
  });

  it('400s on an unparseable expectedUpdatedAt instead of skipping the check', async () => {
    // Previously returned null, so a malformed value silently disabled optimistic
    // concurrency and the update went through unguarded.
    const { db } = stubDb([{ updatedAt: new Date() }]);

    const res = await concurrencyGuard(db, softDeleted, ID, TENANT, 'yesterday-ish');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });

  it('cannot guard a table without updatedAt, and says so by passing', async () => {
    const { db } = stubDb([]);

    const res = await concurrencyGuard(db, noUpdatedAt, ID, TENANT, '2026-01-01T00:00:00.000Z');

    expect(res).toBeNull();
  });
});

describe('concurrencyGuardById', () => {
  it('omits the tenant predicate but keeps the soft-delete one', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const { db, captured } = stubDb([{ updatedAt: when }]);

    const res = await concurrencyGuardById(db, softDeleted, ID, when.toISOString());

    expect(res).toBeNull();
    const sql = dialect.sqlToQuery(captured.where!).sql;
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).not.toContain('"tenant_id"');
  });
});

describe('concurrencyGuard — SQL fragment overload', () => {
  it('returns an equality fragment on updatedAt', () => {
    const frag = concurrencyGuard(softDeleted, '2026-01-01T00:00:00.000Z');

    expect(frag).not.toBeNull();
    expect(dialect.sqlToQuery(frag as SQL).sql).toContain('"updated_at" =');
  });

  it('returns null when there is nothing to compare', () => {
    expect(concurrencyGuard(softDeleted, undefined)).toBeNull();
    expect(concurrencyGuard(softDeleted, null)).toBeNull();
  });

  it('returns null for a table with no updatedAt column', () => {
    expect(concurrencyGuard(noUpdatedAt, '2026-01-01T00:00:00.000Z')).toBeNull();
  });
});

describe('checkStaleUpdate', () => {
  it('409s when the update matched no row', async () => {
    const res = checkStaleUpdate(undefined);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
  });

  it('passes when a row came back', () => {
    expect(checkStaleUpdate({ id: ID })).toBeNull();
  });
});
