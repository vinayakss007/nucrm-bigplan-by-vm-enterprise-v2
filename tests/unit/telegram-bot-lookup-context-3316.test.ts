/**
 * #3316 — the Telegram bot told every linked account that it was not linked.
 *
 * `app/api/webhooks/telegram/bot/route.ts` resolves the sender from Telegram's `chat.id`, and did it
 * on the bare pool:
 *
 *   const [matched] = await db.select({ id, email, … }).from(users)
 *     .where(eq(users.telegramChatId, String(chatId))).limit(1);
 *
 * The webhook is anonymous by nature (Telegram posts to it; there is no session to require),
 * `lib/db/pool.ts` clears every `app.*` GUC on acquire *and* release, and `users`' three SELECT arms
 * (0088) key on `app.current_user`, `app.is_super_admin` or `app.auth_lookup`. So the read matched
 * zero rows, always, and the route's own `if (!user)` fallback answered a person who *had* saved
 * their chat id correctly with "To link your account" — forever, on every message, with
 * `200 {"ok":true}` returned to Telegram and nothing logged.
 *
 * The operator branch failed in the other direction and is the reason this is not a one-line wrapper:
 *
 *   user = adminUser || { id: 'cli-admin', email: 'admin@nucrm.local', isSuperAdmin: true, … };
 *
 * A read that cannot see the admin falls through to a *fabricated* one. `/tenants`, `/pending`,
 * `/recent` and `/stats` were then answered by an identity that exists in no row and is attributed to
 * nobody — including the audit trail, which has no `cli-admin` to point at. Ask 2 of the issue is that
 * this becomes a refusal, which is a behaviour change on a live webhook: the operator loses their
 * commands until a real super-admin row with the right `telegramChatId` is visible. That is the point.
 *
 * The fake pool below enforces the policies instead of mocking their output, so the bug is reproduced
 * by the shape of the connection rather than by a stubbed `[]`, and the only way `users` appears in
 * the recorded reads with a row behind it is by earning the privilege. `withAuthLookupContext` is the
 * sanctioned one — SELECT-only, already granted by 0088's `users_auth_lookup`, and the same helper
 * `app/api/auth/forgot-password` (#3288) and `lib/auth/password-reset.ts:77` (#3218) use for the
 * identical pre-auth identity read.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const ROUTE = 'app/api/webhooks/telegram/bot/route.ts';
const BASELINE = 'scripts/rls-preauth-baseline.json';
const GUARD = 'scripts/check-rls-route-coverage.mjs';
const POLICIES = 'drizzle/migrations/0088_rls_bootstrap_and_isolation.sql';

const OPERATOR_CHAT = '999';
const LINKED_CHAT = '555';
const DISABLED_CHAT = '777';
const UNKNOWN_CHAT = '424242';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
}

const ADMIN: UserRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'admin@acme.test',
  fullName: 'Real Admin',
  isSuperAdmin: true,
  telegramEnabled: true,
  telegramChatId: OPERATOR_CHAT,
};
const LINKED: UserRow = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'rep@acme.test',
  fullName: 'Linked Person',
  isSuperAdmin: false,
  telegramEnabled: true,
  telegramChatId: LINKED_CHAT,
};
const DISABLED: UserRow = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  email: 'quiet@acme.test',
  fullName: 'Disabled Person',
  isSuperAdmin: false,
  telegramEnabled: false,
  telegramChatId: DISABLED_CHAT,
};

const TENANTS = [
  { id: 't-1', name: 'Acme', slug: 'acme', planId: 'pro', status: 'active', billingEmail: 'a@acme.test', createdAt: new Date('2026-10-01') },
  { id: 't-2', name: 'Beta', slug: 'beta', planId: 'free', status: 'pending', billingEmail: 'b@beta.test', createdAt: new Date('2026-10-20') },
];

const H = vi.hoisted(() => ({
  ops: [] as string[],
  calls: [] as { sql: string; params: unknown[] }[],
  replies: [] as { chat_id: string; text: string }[],
  users: [] as unknown[],
  denyUsers: false,
}));

interface Conn { authLookup: boolean; currentUser: string; isSuperAdmin: boolean }
const blank = (): Conn => ({ authLookup: false, currentUser: '', isSuperAdmin: false });

function render(f: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(f as SQL);
  return { sql: q.sql, params: q.params };
}

/**
 * `users`' SELECT policies, evaluated rather than stubbed. 0088 gives three arms and an unprivileged
 * connection satisfies none of them, which is the entire bug; `tenants` has
 * `tenants_read_all … USING (true)`, which is why the admin *command* reads are not in scope here.
 */
function selectRows(conn: Conn, table: string, where: unknown): unknown[] {
  H.ops.push(`select:${table}`);
  if (table === 'tenants') return [...TENANTS];
  if (table !== 'users') throw new Error(`harness: no policy modelled for "${table}"`);
  const visible = (H.denyUsers ? [] : [...H.users] as UserRow[]).filter(
    (r) => conn.authLookup || conn.isSuperAdmin || (conn.currentUser && conn.currentUser === r.id),
  );
  if (!where) return visible;
  const { sql: text, params } = render(where);
  if (text.includes('telegram_chat_id')) {
    const want = params.find((p) => typeof p === 'string');
    return visible.filter((r) => r.telegramChatId === want);
  }
  if (text.includes('is_super_admin')) {
    return visible.filter((r) => r.isSuperAdmin === (params[0] ?? true));
  }
  throw new Error(`harness: cannot interpret users predicate: ${text}`);
}

const builderFor = (conn: Conn) => {
  const state: { table?: string; where?: unknown } = {};
  const b: Record<string, unknown> = {
    from: (t: object) => {
      state.table = getTableName(t as never);
      return b;
    },
    where: (f: unknown) => {
      state.where = f;
      return b;
    },
    orderBy: () => b,
    limit: () => b,
    then: (resolve: (v: unknown[]) => void, reject: (e: unknown) => void) => {
      try {
        resolve(selectRows(conn, state.table ?? '?', state.where));
      } catch (e) {
        reject(e);
      }
    },
  };
  return b;
};

const txFor = (conn: Conn) => ({
  select: () => builderFor(conn),
  execute: (f: unknown) => {
    const call = render(f);
    H.calls.push(call);
    if (call.sql.includes('set_config')) H.ops.push('set_config');
    const granted = (guc: string) => call.sql.includes(`set_config('app.${guc}', 'true'`);
    if (granted('auth_lookup')) conn.authLookup = true;
    if (granted('is_super_admin')) conn.isSuperAdmin = true;
    const asUser = call.sql.indexOf("set_config('app.current_user', $");
    if (asUser >= 0) {
      const ordinal = (call.sql.slice(0, asUser).match(/\$\d+/g) ?? []).length;
      conn.currentUser = String(call.params[ordinal - 1] ?? '');
    }
    return Promise.resolve([]);
  },
});

const BARE: Conn = blank();

vi.mock('@/drizzle/db', () => ({
  db: {
    // The pool as `lib/db/pool.ts` hands it out: every `app.*` GUC cleared.
    select: () => builderFor(BARE),
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      H.ops.push('BEGIN');
      const conn = blank();
      try {
        return await cb(txFor(conn));
      } finally {
        H.ops.push('END');
      }
    },
  },
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

async function bot(chatId: string, text: string) {
  const { POST } = await import('@/app/api/webhooks/telegram/bot/route');
  const request = new Request('http://localhost/api/webhooks/telegram/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
    body: JSON.stringify({ message: { chat: { id: Number(chatId) }, from: { id: Number(chatId) }, text } }),
  });
  return POST(request as never);
}

const lastReply = () => H.replies[H.replies.length - 1]?.text ?? '';
const allText = () => H.replies.map((r) => r.text).join('\n');
const setConfigs = () => H.calls.filter((c) => c.sql.includes('set_config'));

beforeEach(() => {
  H.ops = [];
  H.calls = [];
  H.replies = [];
  H.users = [ADMIN, LINKED, DISABLED];
  H.denyUsers = false;
  vi.resetModules();
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token-never-log-me';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.TELEGRAM_CHAT_ID = OPERATOR_CHAT;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    H.replies.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_CHAT_ID;
});

describe('ask 1 — the webhook reads the sender through a privilege that can see them', () => {
  it('a linked user gets their own account, not the link-your-account script', async () => {
    const res = await bot(LINKED_CHAT, '/start');
    expect(res.status).toBe(200);
    expect(lastReply()).toContain('Linked Person');
    expect(allText(), 'a person who linked correctly must never be told to link').not.toContain('To link your account');
  });

  it('opens app.auth_lookup for the users read, transaction-locally, and reads after granting', async () => {
    await bot(LINKED_CHAT, '/info');
    const claim = setConfigs().find((c) => c.sql.includes('app.auth_lookup'));
    expect(claim, 'users has no SELECT arm an unprivileged connection can satisfy').toBeDefined();
    expect(claim!.sql).toMatch(/set_config\('app\.auth_lookup', 'true', true\)/);
    expect(H.ops[0], 'the privilege must not outlive the lookup').toBe('BEGIN');
    expect(H.ops.indexOf('set_config'), 'the grant is issued inside the transaction').toBeGreaterThan(0);
    expect(H.ops.indexOf('select:users'), 'the grant has to precede the read').toBeGreaterThan(H.ops.indexOf('set_config'));
  });

  it('takes the users read through a transaction, not the pool', () => {
    const src = read(ROUTE);
    expect(src).toMatch(/withAuthLookupContext\(/);
    expect(src, 'db.select().from(users) answers zero rows for every chat id').not.toMatch(/\bdb\s*\.\s*select\s*\([^)]*\)\s*\n?\s*\.from\(\s*users\b/);
    expect(src).toMatch(/import \{[^}]*withAuthLookupContext[^}]*\} from '@\/lib\/db\/rls'/);
  });

  it('a linked account whose Telegram is switched off is told that, not told to link', async () => {
    await bot(DISABLED_CHAT, '/start');
    expect(lastReply()).toContain('not enabled');
    expect(allText()).not.toContain('To link your account');
  });

  it('still answers the linking instructions for a chat id no row claims', async () => {
    await bot(UNKNOWN_CHAT, '/start');
    expect(lastReply()).toContain('To link your account');
    expect(H.ops.filter((o) => o === 'select:tenants'), 'an unverified chat must not reach an admin command').toEqual([]);
  });
});

describe('ask 2 — the operator branch stops inventing an admin', () => {
  it('answers the operator as the admin row, not as a literal', async () => {
    const res = await bot(OPERATOR_CHAT, '/info');
    expect(res.status).toBe(200);
    expect(lastReply()).toContain('Real Admin');
    expect(allText(), 'no response may be built from the placeholder identity').not.toMatch(/cli-admin|admin@nucrm\.local|Name: Super Admin/);
  });

  it('refuses when no row says this chat is an admin, instead of becoming one', async () => {
    H.users = [LINKED, DISABLED];
    const res = await bot(OPERATOR_CHAT, '/tenants');
    expect(res.status).toBe(200);
    expect(lastReply(), 'the refusal is the whole guarantee: no admin surface without a row').toMatch(/could not be verified/i);
    expect(H.ops.filter((o) => o === 'select:tenants'), 'a fabricated admin must not get to list tenants').toEqual([]);
    expect(allText()).not.toContain('Acme');
  });

  it('the synthetic identity is gone from the source, not just unreachable', () => {
    expect(read(ROUTE), 'an id that exists in no table cannot be audited').not.toMatch(/cli-admin/);
    expect(read(ROUTE)).not.toMatch(/admin@nucrm\.local/);
  });

  it('admin commands still work for a real admin row', async () => {
    const res = await bot(OPERATOR_CHAT, '/tenants');
    expect(res.status).toBe(200);
    expect(H.ops).toContain('select:tenants');
    expect(lastReply()).toContain('Acme');
  });

  it('never lets the bearer values leak into what the bot says', async () => {
    await bot(LINKED_CHAT, '/start');
    expect(allText()).not.toMatch(/bot-token-never-log-me|test-webhook-secret|rep@acme\.test/);
  });
});

describe('ask 3 — the screen that found this stops tolerating it', () => {
  it('drops both telegram entries from the shrink-only baseline', () => {
    const baseline = JSON.parse(read(BASELINE)) as Record<string, unknown>;
    const key = `${ROUTE}|PREAUTH_UNCONTEXTED_READ`;
    expect(baseline[key], 'a stale allowance is itself a finding (BASELINE_STALE)').toBeUndefined();
    expect((baseline._reasons as Record<string, unknown>)[key]).toBeUndefined();
    expect(JSON.stringify(baseline)).not.toContain('telegram/bot');
  });

  it('the shipped policy arm the fix relies on is the one 0088 already grants', () => {
    const sql = read(POLICIES);
    expect(sql).toMatch(/CREATE POLICY "users_auth_lookup" ON "users" FOR SELECT USING \(\s*\(current_setting\('app\.auth_lookup', true\)\)::text = 'true'\s*\)/);
    expect(read(ROUTE)).not.toMatch(/CREATE POLICY|DROP POLICY/);
  });

  it('guard:rls is green over the real tree', () => {
    // The screen's own fixture behaviour is proven in rls-preauth-route-screen-3288.test.ts; this is
    // the real tree, where a leftover allowance for a site that no longer exists is a finding.
    const r = spawnSync(process.execPath, [join(ROOT, GUARD)], { cwd: ROOT, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    expect(r.status, `guard:rls exited ${r.status}: ${out}`).toBe(0);
  });
});
