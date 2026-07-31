/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for POST /api/webhooks/resend — bounce/complaint suppression.
 *
 * Background: the bounce/complaint branch ran three statements inside one
 * transaction — flag the contact `doNotContact`, cancel its active sequence
 * enrollments, then write an `activities` row. The activity payload used a
 * `type: 'note'` key, but `activities` has no `type` column; the real column is
 * NOT NULL `event_type`. Drizzle silently dropped the unknown key, so
 * `event_type` was never supplied and the insert raised a NOT NULL violation.
 * Being inside the transaction, that violation rolled back the two statements
 * that actually mattered: bounced and complaining addresses were never
 * suppressed and kept receiving automated email.
 *
 * The fix populates `eventType` and moves the activity write after the commit
 * with its own catch, so activity bookkeeping can never again undo suppression.
 *
 * The db mock records the payload handed to Drizzle (following the ordered-op
 * recorder in tests/unit/pipelines-stage-safety.test.ts) because these
 * assertions are about payload shape — in particular that every key in the
 * activity insert is a real column. The schema module is deliberately NOT
 * mocked so `getTableColumns(activities)` reflects the true table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getTableColumns } from 'drizzle-orm';
import { contacts, sequenceEnrollments, activities } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; table?: unknown; payload?: unknown }>,
  /** Rows the `update(contacts) ... returning()` resolves with. */
  contactReturning: [] as unknown[],
  /** When set, `insert(activities).values()` rejects with it. */
  activityInsertError: null as Error | null,
  /** Incremented only when the transaction callback resolved (i.e. committed). */
  commits: 0,
  /** Incremented when the transaction callback threw (i.e. rolled back). */
  rollbacks: 0,
}));

/**
 * The activities insert mock emulates the two database behaviours that combined
 * to cause this bug: Drizzle silently drops object keys that are not columns,
 * and Postgres then rejects the row for the NOT NULL column left unfilled. That
 * makes the mock an oracle rather than a rubber stamp — a payload with the old
 * `type: 'note'` key fails here exactly as it does in production.
 */
const NOT_NULL_ACTIVITY_COLUMNS = ['tenantId', 'entityType', 'entityId', 'eventType'];

vi.mock('@/drizzle/db', async () => {
  const { activities: activitiesTable, contacts: contactsTable } = await import('@/drizzle/schema');
  const { getTableColumns: columnsOf } = await import('drizzle-orm');
  const activityColumns = new Set(Object.keys(columnsOf(activitiesTable)));

  function activityConstraintViolation(payload: unknown): Error | null {
    const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
    for (const row of rows) {
      // Drizzle only forwards keys it recognises as columns.
      const stored = Object.fromEntries(
        Object.entries(row ?? {}).filter(([key]) => activityColumns.has(key))
      );
      for (const column of NOT_NULL_ACTIVITY_COLUMNS) {
        if (stored[column] == null) {
          return new Error(
            `null value in column "${column}" of relation "activities" violates not-null constraint`
          );
        }
      }
    }
    return null;
  }

  const db: any = {
    update: (table: unknown) => {
      const rec: any = { op: 'update', table };
      h.ops.push(rec);
      const chain: any = {
        set: (p: unknown) => {
          rec.payload = p;
          return chain;
        },
        where: () => chain,
        returning: async () => (table === contactsTable ? h.contactReturning : []),
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    insert: (table: unknown) => {
      const rec: any = { op: 'insert', table };
      h.ops.push(rec);
      const chain: any = {
        values: (p: unknown) => {
          rec.payload = p;
          if (table === activitiesTable) {
            const failure = h.activityInsertError ?? activityConstraintViolation(p);
            if (failure) return Promise.reject(failure);
          }
          return chain;
        },
        returning: async () => [],
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    transaction: async (cb: any) => {
      try {
        const result = await cb(db);
        h.commits++;
        return result;
      } catch (err) {
        h.rollbacks++;
        throw err;
      }
    },
  };
  return { db };
});

const mockLogError = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/errors-server', () => ({ logError: mockLogError }));

// Mirrors the real signature `apiError(err, message = 'Internal server error',
// status = 500)` so the defaulted single-argument call in the route behaves the
// same here without dragging Sentry into a unit test.
const mockApiError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown, message = 'Internal server error', status = 500) => {
    mockApiError(err, message, status);
    return NextResponse.json({ error: message }, { status });
  },
}));

const CONTACT_A = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  firstName: 'Ada',
};
const CONTACT_B = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: '22222222-2222-4222-8222-222222222222',
  firstName: 'Grace',
};

/** A Resend webhook request. `raw` sends the body verbatim, for malformed cases. */
function req(body: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function event(type: string, to: string[] = ['bounced@example.com']) {
  return { type, data: { email_id: 'e-1', to, from: 'sender@nucrm.test', created_at: '2026-01-01T00:00:00Z' } };
}

function post(body: unknown, raw?: string) {
  return import('@/app/api/webhooks/resend/route').then((m) => m.POST(req(body, raw)));
}

function opsOn(table: unknown) {
  return h.ops.filter((o) => o.table === table);
}

/** The rows handed to `insert(activities).values()`, flattened. */
function activityRows(): Record<string, unknown>[] {
  return opsOn(activities)
    .filter((o) => o.op === 'insert' && o.payload !== undefined)
    .flatMap((o) => (Array.isArray(o.payload) ? o.payload : [o.payload]) as Record<string, unknown>[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ops = [];
  h.contactReturning = [CONTACT_A];
  h.activityInsertError = null;
  h.commits = 0;
  h.rollbacks = 0;
  delete process.env.RESEND_WEBHOOK_SECRET;
});

describe('resend webhook — suppression is persisted', () => {
  it('email.bounced sets doNotContact: true on the matching contact', async () => {
    const res = await post(event('email.bounced'));

    expect(res.status).toBe(200);
    const contactUpdates = opsOn(contacts).filter((o) => o.op === 'update');
    expect(contactUpdates).toHaveLength(1);
    expect(contactUpdates[0]!.payload).toMatchObject({ doNotContact: true });
  });

  it('email.complained sets doNotContact: true on the matching contact', async () => {
    const res = await post(event('email.complained', ['angry@example.com']));

    expect(res.status).toBe(200);
    const contactUpdates = opsOn(contacts).filter((o) => o.op === 'update');
    expect(contactUpdates).toHaveLength(1);
    expect(contactUpdates[0]!.payload).toMatchObject({ doNotContact: true });
  });

  it('cancels active sequence enrollments for the affected contacts', async () => {
    await post(event('email.bounced'));

    const enrollmentUpdates = opsOn(sequenceEnrollments).filter((o) => o.op === 'update');
    expect(enrollmentUpdates).toHaveLength(1);
    expect(enrollmentUpdates[0]!.payload).toMatchObject({ status: 'cancelled' });
    expect(h.commits).toBe(1);
    expect(h.rollbacks).toBe(0);
  });

  it('suppresses every contact returned for the address', async () => {
    h.contactReturning = [CONTACT_A, CONTACT_B];

    const res = await post(event('email.bounced'));

    expect(res.status).toBe(200);
    expect(activityRows()).toHaveLength(2);
    expect(activityRows().map((r) => r['contactId'])).toEqual([CONTACT_A.id, CONTACT_B.id]);
  });

  it('returns its normal success response on the happy path', async () => {
    const res = await post(event('email.bounced'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
  });
});

describe('resend webhook — activity payload shape', () => {
  it('supplies eventType, and its value is a non-empty string', async () => {
    await post(event('email.bounced'));

    const rows = activityRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('eventType');
    expect(typeof rows[0]!['eventType']).toBe('string');
    expect((rows[0]!['eventType'] as string).length).toBeGreaterThan(0);
  });

  it('does not use a `type` key — there is no such column', async () => {
    await post(event('email.complained'));

    const rows = activityRows();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!)).not.toContain('type');
    expect(rows[0]).not.toHaveProperty('type');
  });

  it('uses only real `activities` columns, so any future ghost key fails here', async () => {
    await post(event('email.bounced'));

    const columns = Object.keys(getTableColumns(activities));
    // Sanity-check the oracle itself before trusting it.
    expect(columns).toContain('eventType');
    expect(columns).not.toContain('type');

    const rows = activityRows();
    expect(rows).toHaveLength(1);
    for (const key of Object.keys(rows[0]!)) {
      expect(columns, `activity insert key "${key}" is not a column on activities`).toContain(key);
    }
  });

  it('supplies every NOT NULL activities column without a default', async () => {
    await post(event('email.bounced'));

    const row = activityRows()[0]!;
    // tenant_id, entity_type, entity_id and event_type are all NOT NULL with no
    // default, so omitting any one of them is a guaranteed insert failure.
    for (const required of ['tenantId', 'entityType', 'entityId', 'eventType']) {
      expect(row[required], `missing NOT NULL column ${required}`).toBeTruthy();
    }
  });

  it('points the polymorphic entity pair at the contact', async () => {
    const res = await post(event('email.bounced'));

    expect(res.status).toBe(200);
    expect(activityRows()[0]).toMatchObject({
      tenantId: CONTACT_A.tenantId,
      contactId: CONTACT_A.id,
      entityType: 'contact',
      entityId: CONTACT_A.id,
      action: 'email.bounced',
    });
  });
});

describe('resend webhook — an activity failure must not undo suppression', () => {
  it('still issues the contact update when the activity insert rejects', async () => {
    h.activityInsertError = new Error('null value in column "event_type" violates not-null constraint');

    const res = await post(event('email.bounced'));

    const contactUpdates = opsOn(contacts).filter((o) => o.op === 'update');
    expect(contactUpdates).toHaveLength(1);
    expect(contactUpdates[0]!.payload).toMatchObject({ doNotContact: true });
    // The endpoint must not fail, and the transaction carrying the suppression
    // must have committed rather than rolled back.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(h.commits).toBe(1);
    expect(h.rollbacks).toBe(0);
  });

  it('still cancels enrollments when the activity insert rejects', async () => {
    h.activityInsertError = new Error('activities insert exploded');

    await post(event('email.complained'));

    const enrollmentUpdates = opsOn(sequenceEnrollments).filter((o) => o.op === 'update');
    expect(enrollmentUpdates).toHaveLength(1);
    expect(enrollmentUpdates[0]!.payload).toMatchObject({ status: 'cancelled' });
    // Recording the statement is not enough — it has to have been committed.
    expect(h.commits).toBe(1);
    expect(h.rollbacks).toBe(0);
  });

  it('logs an activity-insert failure instead of swallowing it silently', async () => {
    const boom = new Error('activities insert exploded');
    h.activityInsertError = boom;

    await post(event('email.bounced'));

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [arg] = mockLogError.mock.calls[0] as [{ error: unknown; context?: string }];
    expect(arg.error).toBe(boom);
    expect(arg.context).toContain('resend-webhook');
    // Logged, not converted into a failed response.
    expect(mockApiError).not.toHaveBeenCalled();
  });
});

describe('resend webhook — events that must not write', () => {
  it('writes nothing when no contact matches the email', async () => {
    h.contactReturning = [];

    const res = await post(event('email.bounced', ['nobody@example.com']));

    expect(res.status).toBe(200);
    expect(opsOn(activities)).toHaveLength(0);
    expect(opsOn(sequenceEnrollments)).toHaveLength(0);
  });

  it('performs no writes for email.delivered', async () => {
    const res = await post(event('email.delivered'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(h.ops).toHaveLength(0);
    expect(h.commits).toBe(0);
  });

  it('performs no writes for an unhandled event type', async () => {
    const res = await post(event('email.opened'));

    expect(res.status).toBe(200);
    expect(h.ops).toHaveLength(0);
  });

  it('performs no writes for a bounce with no recipient address', async () => {
    const res = await post({ type: 'email.bounced', data: { created_at: '2026-01-01T00:00:00Z' } });

    expect(res.status).toBe(200);
    expect(h.ops).toHaveLength(0);
  });
});

describe('resend webhook — malformed input', () => {
  it('does not throw on a body that is not valid JSON', async () => {
    const res = await post(undefined, '{ not json');

    // Handled by the route's catch: logged, then answered via apiError's
    // default 500 / { error } shape rather than an unhandled rejection.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(mockLogError).toHaveBeenCalled();
    expect(h.ops).toHaveLength(0);
  });

  it('does not throw on valid JSON that is not a Resend event', async () => {
    const res = await post({ hello: 'world' });

    expect(res.status).toBe(200);
    expect(h.ops).toHaveLength(0);
  });

  it('rejects a request with the wrong webhook secret without writing', async () => {
    process.env.RESEND_WEBHOOK_SECRET = 'expected-secret';

    const res = await post(event('email.bounced'));

    expect(res.status).toBe(401);
    expect(h.ops).toHaveLength(0);
  });
});
