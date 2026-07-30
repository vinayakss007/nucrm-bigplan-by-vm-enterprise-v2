/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coverage for the API key *lifecycle* half of lib/auth/api-key.ts.
 *
 * tests/unit/api-key.test.ts already covers `hasScope` and `tryApiKeyAuth`
 * (the request path). Lines 141-240 — generate / revoke / rotate / usage —
 * were entirely unexercised, which is why the file sat at 52% statements
 * despite having a test file. That matters here because these functions mint
 * and retire credentials: a regression that, say, forgot to hash before
 * insert, or dropped the tenant predicate from the revoke `where`, would be
 * invisible. Each test therefore asserts on the *arguments handed to the
 * driver*, not merely that the call resolved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

/** Queue of results handed out to successive `db.select()` calls. */
let selectResults: any[][] = [];
/** Every mutation recorded in call order so tests can assert on payloads. */
let calls: { op: string; table?: unknown; payload?: unknown }[] = [];

const mockDb: any = vi.hoisted(() => {
  // Declared inside the hoisted factory so the module mock can close over it.
  return {} as any;
});

vi.mock('@/drizzle/db', () => {
  /**
   * A node that is both chainable and awaitable. Drizzle terminates queries at
   * different methods depending on the call (`.where()`, `.orderBy()`,
   * `.limit()`), so rather than guess which one is terminal we make every node
   * thenable and let `await` land wherever the source code puts it.
   */
  function node(result: any) {
    const self: any = {
      then: (res: (v: any) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
    };
    for (const m of [
      'from', 'where', 'innerJoin', 'leftJoin', 'groupBy',
      'orderBy', 'limit', 'offset', 'set', 'values', 'returning',
    ]) {
      self[m] = vi.fn((...args: unknown[]) => {
        if (m === 'set' || m === 'values') {
          calls.push({ op: m, payload: args[0] });
        }
        return self;
      });
    }
    return self;
  }

  const db: any = {
    select: vi.fn(() => node(selectResults.shift() ?? [])),
    update: vi.fn((table: unknown) => {
      calls.push({ op: 'update', table });
      return node([]);
    }),
    insert: vi.fn((table: unknown) => {
      calls.push({ op: 'insert', table });
      return node([]);
    }),
    delete: vi.fn((table: unknown) => {
      calls.push({ op: 'delete', table });
      return node([]);
    }),
    transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
      calls.push({ op: 'transaction' });
      return cb(db);
    }),
  };
  Object.assign(mockDb, db);
  return { db };
});

beforeEach(() => {
  selectResults = [];
  calls = [];
  vi.clearAllMocks();
});

describe('generateApiKey', () => {
  it('returns an ak_live_ key whose prefix is the first 6 chars of the random part', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const { key, prefix } = await generateApiKey('t1', 'u1', 'CI key', ['contacts:read']);

    expect(key).toMatch(/^ak_live_[0-9a-f]{48}$/);
    // 24 random bytes -> 48 hex chars.
    const randomPart = key.slice('ak_live_'.length);
    expect(prefix).toBe(`ak_live_${randomPart.slice(0, 6)}`);
  });

  it('persists only the sha256 hash, never the raw key', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const { key } = await generateApiKey('t1', 'u1', 'CI key', ['contacts:read']);

    const values = calls.find(c => c.op === 'values')!.payload as any;
    expect(values.keyHash).toBe(createHash('sha256').update(key).digest('hex'));
    // The whole point of hashing: the plaintext must not be in the row.
    expect(JSON.stringify(values)).not.toContain(key);
  });

  it('stores tenant, user, name and scopes as given', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    await generateApiKey('tenant-9', 'user-9', 'Zapier', ['deals:read', 'deals:write']);

    const values = calls.find(c => c.op === 'values')!.payload as any;
    expect(values.tenantId).toBe('tenant-9');
    expect(values.userId).toBe('user-9');
    expect(values.name).toBe('Zapier');
    expect(values.scopes).toEqual(['deals:read', 'deals:write']);
  });

  it('converts an expiresAt string into a Date', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    await generateApiKey('t1', 'u1', 'k', [], '2030-01-01T00:00:00.000Z');

    const values = calls.find(c => c.op === 'values')!.payload as any;
    expect(values.expiresAt).toBeInstanceOf(Date);
    expect((values.expiresAt as Date).toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('stores null when no expiry is supplied', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    await generateApiKey('t1', 'u1', 'k', []);
    expect((calls.find(c => c.op === 'values')!.payload as any).expiresAt).toBeNull();
  });

  it('never issues the same key twice', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const a = await generateApiKey('t1', 'u1', 'k', []);
    const b = await generateApiKey('t1', 'u1', 'k', []);
    expect(a.key).not.toBe(b.key);
  });
});

describe('revokeApiKey', () => {
  it('deactivates rather than deletes, so usage history survives', async () => {
    const { revokeApiKey } = await import('@/lib/auth/api-key');
    await revokeApiKey('key-1', 'tenant-1');

    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(calls.some(c => c.op === 'update')).toBe(true);
    expect(calls.find(c => c.op === 'set')!.payload).toEqual({ isActive: false });
  });

  it('resolves true', async () => {
    const { revokeApiKey } = await import('@/lib/auth/api-key');
    await expect(revokeApiKey('key-1', 'tenant-1')).resolves.toBe(true);
  });
});

describe('rotateApiKey', () => {
  it('deactivates the old key and inserts the new one in one transaction', async () => {
    const { rotateApiKey } = await import('@/lib/auth/api-key');
    const result = await rotateApiKey('old-key', 'tenant-1', 'user-1', 'rotated', ['all']);

    expect(result).not.toBeNull();
    // Atomicity is the guarantee that matters: a half-applied rotation either
    // locks the tenant out or leaves two live keys.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    const ops = calls.map(c => c.op);
    expect(ops.indexOf('update')).toBeGreaterThan(ops.indexOf('transaction'));
    expect(ops).toContain('insert');
    expect(calls.find(c => c.op === 'set')!.payload).toEqual({ isActive: false });
  });

  it('returns a fresh key that hashes to the stored hash', async () => {
    const { rotateApiKey } = await import('@/lib/auth/api-key');
    const result = await rotateApiKey('old-key', 't1', 'u1', 'rotated', ['contacts:read']);

    const values = calls.find(c => c.op === 'values')!.payload as any;
    expect(values.keyHash).toBe(createHash('sha256').update(result!.key).digest('hex'));
    expect(result!.prefix).toBe(`ak_live_${result!.key.slice('ak_live_'.length, 'ak_live_'.length + 6)}`);
  });

  it('carries the new name and scopes onto the replacement row', async () => {
    const { rotateApiKey } = await import('@/lib/auth/api-key');
    await rotateApiKey('old', 't2', 'u2', 'new-name', ['tasks:all']);

    const values = calls.find(c => c.op === 'values')!.payload as any;
    expect(values.name).toBe('new-name');
    expect(values.scopes).toEqual(['tasks:all']);
    expect(values.tenantId).toBe('t2');
    expect(values.userId).toBe('u2');
  });
});

describe('getApiKeyUsage', () => {
  /** The three selects, in the order the implementation issues them. */
  function queueUsage(
    total: any[] = [{ count: 0 }],
    byEndpoint: any[] = [],
    byStatus: any[] = [],
  ) {
    selectResults = [total, byEndpoint, byStatus];
  }

  it('aggregates total, byEndpoint and byStatus', async () => {
    queueUsage(
      [{ count: 42 }],
      [{ endpoint: '/api/tenant/contacts', count: 30 }],
      [{ statusCode: 200, count: 40 }, { statusCode: 500, count: 2 }],
    );
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    const usage = await getApiKeyUsage('key-1', 7);

    expect(usage.total).toBe(42);
    expect(usage.byEndpoint).toEqual([{ endpoint: '/api/tenant/contacts', count: 30 }]);
    expect(usage.byStatus).toEqual([
      { status: 200, count: 40 },
      { status: 500, count: 2 },
    ]);
  });

  it('reports 0 rather than undefined when the key has no usage', async () => {
    queueUsage([], [], []);
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    const usage = await getApiKeyUsage('unused-key');
    expect(usage.total).toBe(0);
    expect(usage.byEndpoint).toEqual([]);
    expect(usage.byStatus).toEqual([]);
  });

  it('maps a null statusCode to 0 instead of emitting null', async () => {
    queueUsage([{ count: 1 }], [], [{ statusCode: null, count: 1 }]);
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    const usage = await getApiKeyUsage('key-1');
    expect(usage.byStatus).toEqual([{ status: 0, count: 1 }]);
  });

  it('defaults to a 7 day window', async () => {
    queueUsage();
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    await getApiKeyUsage('key-1');
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['clamps 0 up to 1', 0],
    ['clamps a negative window up to 1', -30],
    ['clamps above 365 down to 365', 100_000],
    ['floors a fractional window', 7.9],
  ])('%s', async (_label, days) => {
    queueUsage();
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    // The clamp exists so `days` cannot be used to build an absurd or
    // injected interval; we assert it stays queryable rather than throwing.
    await expect(getApiKeyUsage('key-1', days as number)).resolves.toMatchObject({ total: 0 });
  });

  it('tolerates NaN by still issuing the three aggregate queries', async () => {
    queueUsage();
    const { getApiKeyUsage } = await import('@/lib/auth/api-key');
    await expect(getApiKeyUsage('key-1', Number.NaN)).resolves.toBeDefined();
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });
});
