/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2826 — `app/api/tenant/trash/auto-cleanup` adds its five trash counts with `+`, and
 * node-postgres hands `count(*)` (an `int8`) back as a JavaScript **string**, so `+`
 * concatenates. Measured against a real PostgreSQL 16 with 3 / 2 / 0 / 1 / 4 soft-deleted
 * rows: the endpoint answered `total: "32014"` where 10 records are pending.
 *
 * The harness below therefore returns what the driver really returns. `tests/unit/
 * analytics-numeric-probability-2774.test.ts` makes the same point for `numeric`: a fake
 * that hands back the type the cast *assumed* is the fiction that let this class survive
 * review — and this route had no test at all.
 *
 * The second half is the only consumer, `app/tenant/settings/security/page.tsx`: it types
 * the response as `{ data?: PendingDeletion }` and renders `pendingDeletion.cutoff_date`,
 * while the handler emits `{ pending_deletion, retention_days, cutoff_date }`. The banner
 * is therefore never rendered, and would show `N/A` for the date even after the wrapper is
 * fixed. Both are pinned here against the keys the handler actually emits.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const ROOT = join(import.meta.dirname!, '..', '..');
const TENANT = '11111111-1111-4111-8111-111111111111';

/** Every field as the driver sends it: a decimal string, never a number. */
const DRIVER_COUNTS: Record<string, string> = {
  contacts: '3',
  companies: '2',
  deals: '0',
  tasks: '1',
  leads: '4',
};
/** 3 + 2 + 0 + 1 + 4 — and `"3" + "2" + "0" + "1" + "4"` is "32014", which is the bug. */
const TRUE_TOTAL = 10;

const h = vi.hoisted(() => ({
  rows: {} as Record<string, { count: unknown }[]>,
  rowCount: 2,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      let table = '';
      const b: Record<string, unknown> = {};
      b['from'] = (t: object) => {
        table = getTableName(t as never);
        return b;
      };
      for (const m of ['where', 'limit', 'orderBy', 'groupBy', 'leftJoin', 'innerJoin']) {
        b[m] = () => b;
      }
      b['then'] = (done: (v: unknown) => unknown) =>
        Promise.resolve(h.rows[table] ?? []).then(done);
      return b;
    },
    transaction: (fn: (tx: { delete: () => { where: () => Promise<{ rowCount: number }> } }) => Promise<unknown>) =>
      fn({ delete: () => ({ where: () => Promise.resolve({ rowCount: h.rowCount }) }) }),
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/trash/auto-cleanup/route');

const ctx = {
  userId: 'user-1', tenantId: TENANT, roleSlug: 'admin',
  permissions: {}, isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

/** Prose cannot make a page read a key or a handler sum a string, so full-line `//` comments
 *  and `/* *\/` blocks are dropped before either file is scraped. Without this, the
 *  explanation this PR adds to `security/page.tsx` — which names the old `cleanupData?.data`
 *  read — would satisfy the matcher it is meant to fail. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function seed(counts: Record<string, string | number>): void {
  h.rows = Object.fromEntries(
    Object.entries(counts).map(([table, count]) => [table, [{ count }]]),
  );
  h.rows['platform_settings'] = [];
}

async function call(method: 'GET' | 'POST'): Promise<Record<string, unknown>> {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/trash/auto-cleanup`), {
    method,
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  const handler = (method === 'GET' ? route.GET : route.POST) as (r: NextRequest) => Promise<Response>;
  const res = await handler(req);
  expect(res.status, `${method} did not answer 200`).toBe(200);
  return await res.json() as Record<string, unknown>;
}

beforeEach(() => {
  h.rows = {};
  h.rowCount = 2;
  seed(DRIVER_COUNTS);
});

describe('GET /api/tenant/trash/auto-cleanup sums its counts instead of gluing them', () => {
  it('total is the arithmetic sum of the driver strings, not their concatenation', async () => {
    const json = await call('GET');
    const pending = json['pending_deletion'] as Record<string, unknown>;
    expect(pending['total'], JSON.stringify(pending)).toBe(TRUE_TOTAL);
    expect(typeof pending['total']).toBe('number');
  });

  it('no field is a quoted integer', async () => {
    const pending = (await call('GET'))['pending_deletion'] as Record<string, unknown>;
    for (const field of ['contacts', 'companies', 'deals', 'tasks', 'leads', 'total']) {
      expect(typeof pending[field], `${field} = ${JSON.stringify(pending[field])}`).toBe('number');
    }
    expect(pending['contacts']).toBe(3);
    expect(pending['companies']).toBe(2);
    expect(pending['deals'], 'a zero count must not shift the digits beside it').toBe(0);
    expect(pending['tasks']).toBe(1);
    expect(pending['leads']).toBe(4);
  });

  it('an empty trash is 0, not "00000"', async () => {
    seed(Object.fromEntries(Object.keys(DRIVER_COUNTS).map((t) => [t, '0'])));
    const pending = (await call('GET'))['pending_deletion'] as Record<string, unknown>;
    expect(pending['total']).toBe(0);
    expect(typeof pending['total']).toBe('number');
  });

  it('a count the driver did parse is still counted correctly', async () => {
    seed({ contacts: 7, companies: 7, deals: 7, tasks: 7, leads: 7 });
    const pending = (await call('GET'))['pending_deletion'] as Record<string, unknown>;
    expect(pending['total'], '35, not "77777"').toBe(35);
  });

  it('a missing count row is 0 rather than NaN in the body', async () => {
    h.rows = { platform_settings: [] };
    const pending = (await call('GET'))['pending_deletion'] as Record<string, unknown>;
    expect(pending['total']).toBe(0);
    expect(Number.isNaN(pending['total'])).toBe(false);
  });

  it('still reports the retention window beside the counts', async () => {
    const json = await call('GET');
    expect(json['retention_days']).toBe(30);
    expect(typeof json['cutoff_date']).toBe('string');
  });
});

describe('POST /api/tenant/trash/auto-cleanup answers with numbers in both halves', () => {
  it('cleaned_up (rowCount, already a number) and remaining_in_trash agree in type', async () => {
    const json = await call('POST');
    const cleaned = json['cleaned_up'] as Record<string, unknown>;
    const remaining = json['remaining_in_trash'] as Record<string, unknown>;
    expect(cleaned['contacts']).toBe(2);
    for (const field of ['contacts', 'companies', 'deals', 'tasks', 'leads']) {
      expect(typeof remaining[field], `remaining_in_trash.${field} = ${JSON.stringify(remaining[field])}`)
        .toBe(typeof cleaned[field]);
      expect(typeof remaining[field]).toBe('number');
    }
  });
});

describe('the security panel reads the response the handler actually emits', () => {
  const pageSrc = codeOnly(readFileSync(join(ROOT, 'app/tenant/settings/security/page.tsx'), 'utf8'));

  /** Top-level keys of one interface declared in `src`, matched by brace count. */
  function interfaceKeys(src: string, name: string): string[] {
    const start = src.indexOf(`interface ${name} {`);
    expect(start, `page.tsx declares no \`interface ${name}\``).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let i = src.indexOf('{', start);
    const from = i + 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return [...src.slice(from, i).matchAll(/(\w+)\??\s*:/g)].map((m) => m[1]!);
  }

  const accessesOf = (src: string, receiver: string): string[] =>
    [...src.matchAll(new RegExp(`${receiver}\\??\\.(\\w+)`, 'g'))].map((m) => m[1]!);

  it('every key the page expects from the response is a key the handler emits', async () => {
    const emitted = Object.keys(await call('GET'));
    const declared = interfaceKeys(pageSrc, 'AutoCleanupResponse');
    expect(declared.length, 'AutoCleanupResponse declares no fields at all').toBeGreaterThan(0);
    for (const key of declared) {
      expect(emitted, `page.tsx types \`${key}?\` but the handler never sends it`).toContain(key);
    }
    for (const key of accessesOf(pageSrc, 'cleanupData')) {
      expect(emitted, `page.tsx reads \`cleanupData?.${key}\`, which is not emitted`).toContain(key);
    }
  });

  it('the nested object it renders exists, with the fields it renders', async () => {
    const json = await call('GET');
    const readKey = accessesOf(pageSrc, 'cleanupData')[0];
    expect(readKey, 'the page reads no key off the cleanup response').toBeDefined();
    const nested = json[readKey!] as Record<string, unknown> | undefined;
    expect(nested, `\`${readKey}\` is not an object in the response`).toBeDefined();
    const nestedKeys = Object.keys(nested ?? {});
    for (const key of accessesOf(pageSrc, 'pendingDeletion')) {
      expect(nestedKeys, `page.tsx renders \`pendingDeletion.${key}\`, absent from the response`)
        .toContain(key);
    }
    expect(nestedKeys).toContain('total');
  });

  it('the deletion date comes from where the handler puts it', async () => {
    const json = await call('GET');
    // `cutoff_date` is a top-level key, so the page must read it from the response, not
    // from inside the counts object it also renders — #2826's `N/A` half.
    expect(Object.keys(json)).toContain('cutoff_date');
    const nested = json[accessesOf(pageSrc, 'cleanupData')[0]!] as Record<string, unknown>;
    const rendered = accessesOf(pageSrc, 'pendingDeletion');
    if (rendered.includes('cutoff_date')) {
      expect(Object.keys(nested), 'cutoff_date is emitted top-level; the page must not read it off the counts')
        .toContain('cutoff_date');
    }
  });
});

describe('#2826 cannot come back through the door it came in', () => {
  const routeSrc = codeOnly(readFileSync(
    join(ROOT, 'app/api/tenant/trash/auto-cleanup/route.ts'), 'utf8',
  ));

  it('no count is read through an annotation-only sql<number> fragment', () => {
    // `sql<number>\`count(*)\`` carries no decoder: drizzle's noopDecoder passes the
    // driver's string through and the annotation just vouches for it. `count()` from
    // drizzle-orm emits the same SQL and maps it with Number.
    expect(routeSrc).not.toMatch(/sql<\s*number\s*>\s*`\s*count\(\s*\*\s*\)\s*`/);
  });

  it('the total is an arithmetic sum, and every addend is coerced on the way in', () => {
    expect(routeSrc).toMatch(/Number\(/);
    expect(routeSrc).not.toMatch(/\?\.count\s*\|\|\s*0\)\s*\+/);
  });
});
