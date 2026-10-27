/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3290 ask 3 — the screen for process entry points.
 *
 * `guard:raw-sql` looks for SQL a human typed. This looks for the other way a background job can be
 * wrong: a statement on the pool, in a file where nothing pins a connection, against a table RLS will
 * therefore filter to nothing. `worker.ts:255` and `worker.ts:324` were exactly that — a
 * `database.select()`/`database.update()` pair whose zero-row answer got logged as a *finding*
 * ("already_processed") rather than as a missing privilege.
 *
 * What makes an entry point different from a route is not style, it is that there is no request:
 * `lib/db/request-connection.ts` keys a pinned connection off the request lifecycle, and a BullMQ
 * processor has no lifecycle to key on. So the guard asks one question per statement — who is the
 * receiver — and treats `db` / `database` / `pool` as "nobody opened a context here", in that file
 * and for that table.
 *
 * The table set is read out of `drizzle/schema/**`, so the fixtures below declare their own tables and
 * the screen's answer is about the declaration, not about a name hard-coded in the guard. That is the
 * part worth keeping honest: a transcribed list is how the next tenant table is invisible here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname!, '../..');
const GUARD = join(ROOT, 'scripts/check-rls-route-coverage.mjs');

const made: string[] = [];
let n = 0;

/** A schema declaring one tenant-scoped table and one that is not, plus any entry point under test. */
const SCHEMA = [
  "import { pgTable, uuid, text, jsonb } from 'drizzle-orm/pg-core';",
  "import * as utils from './utils';",
  '',
  "export const notifications = pgTable('notifications', {",
  "  id: uuid('id').primaryKey(),",
  '  tenantId: utils.tenantId(),',
  "  title: text('title'),",
  '});',
  '',
  "export const leadWarmingMessages = pgTable('lead_warming_messages', {",
  '  tenantId: utils.tenantId(),',
  "  status: text('status'),",
  '});',
  '',
  '// No tenant column: a global table, which this rule has nothing to say about.',
  "export const webhookRawPayloads = pgTable('webhook_raw_payloads', {",
  "  id: uuid('id').primaryKey(),",
  "  payload: jsonb('payload'),",
  '});',
].join('\n');

function fixture(files: Record<string, string>, baseline?: Record<string, unknown>): string {
  const d = join(tmpdir(), `rls-entrypoint-${process.pid}-${n++}`);
  made.push(d);
  mkdirSync(join(d, 'drizzle', 'schema'), { recursive: true });
  writeFileSync(join(d, 'drizzle', 'schema', 'comms.ts'), SCHEMA);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(d, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  }
  mkdirSync(join(d, 'scripts'), { recursive: true });
  writeFileSync(join(d, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: {} }, null, 2)}\n`);
  if (baseline !== undefined) {
    writeFileSync(join(d, 'scripts', 'rls-preauth-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  }
  return d;
}

const run = (d: string, extra: string[] = []) => {
  const r = spawnSync('node', [GUARD, '--root', d, ...extra], { encoding: 'utf8' });
  return { out: `${r.stdout}${r.stderr}`, code: r.status };
};

const BARE_INSERT = [
  "import { db } from '@/drizzle/db';",
  "import { notifications } from '@/drizzle/schema';",
  "const worker = new Worker('send-notification', async (job) => {",
  '  const { userId, tenantId, title } = job.data;',
  '  await db.insert(notifications).values({ userId, tenantId, title });',
  '});',
].join('\n');

// The literal shape worker.ts had: the pool re-bound through a dynamic import, so the receiver is
// `database.` and a guard that only knows `db.` would report a clean tree.
const REBOUND_POOL = [
  "const worker = new Worker('send-lead-warming', async (job) => {",
  "  const { db: database } = await import('@/drizzle/db');",
  "  const { leadWarmingMessages } = await import('@/drizzle/schema');",
  '  const claimed = await database.update(leadWarmingMessages)',
  "    .set({ status: 'sending' })",
  '    .returning({ id: leadWarmingMessages.id });',
  '  return claimed.length;',
  '});',
].join('\n');

const IN_CONTEXT = [
  "import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';",
  "import { notifications } from '@/drizzle/schema';",
  "const worker = new Worker('send-notification', async (job) => {",
  '  const { userId, tenantId, title } = job.data;',
  '  await withTenantContext(tenantId, userId, (tx) =>',
  '    tx.insert(notifications).values({ userId, tenantId, title }));',
  '});',
].join('\n');

// Reads as wrapped and is not: the callback ignores the handle that holds the GUC and borrows a
// different connection from the pool, where `app.current_tenant` was just cleared.
const WRAPPED_BUT_BARE = [
  "import { withTenantContext } from '@/lib/db/rls';",
  "import { db } from '@/drizzle/db';",
  "import { notifications } from '@/drizzle/schema';",
  "const worker = new Worker('send-notification', async (job) => {",
  '  await withTenantContext(job.data.tenantId, job.data.userId, () =>',
  '    db.select().from(notifications).limit(1));',
  '});',
].join('\n');

const GLOBAL_TABLE = [
  "import { db } from '@/drizzle/db';",
  "import { webhookRawPayloads } from '@/drizzle/schema';",
  'await db.select().from(webhookRawPayloads).limit(1);',
].join('\n');

let real: { out: string; code: number | undefined };

beforeAll(() => {
  real = run(ROOT);
});

afterAll(() => {
  for (const d of made) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* tmp cleanup is best-effort */ }
  }
});

describe('the entry-point rule sees a tenant write on the pool', () => {
  it('flags db.insert(notifications) in worker.ts', () => {
    const { out, code } = run(fixture({ 'worker.ts': BARE_INSERT }));
    expect(out).toMatch(/ENTRYPOINT_BARE_POOL\tworker.ts:5\tnotifications/);
    expect(code).toBe(1);
  });

  it('flags the same statement when the pool arrives through a re-bound dynamic import', () => {
    const { out } = run(fixture({ 'worker.ts': REBOUND_POOL }));
    expect(out).toMatch(/ENTRYPOINT_BARE_POOL\tworker.ts:4\tlead_warming_messages/);
  });

  it('accepts the identical write inside withTenantContext, on the handle it was given', () => {
    const { out, code } = run(fixture({ 'worker.ts': IN_CONTEXT }));
    expect(out).not.toMatch(/ENTRYPOINT_BARE_POOL/);
    expect(code).toBe(0);
  });

  it('still flags a withTenantContext callback that uses the pool instead of its own tx', () => {
    const { out } = run(fixture({ 'worker.ts': WRAPPED_BUT_BARE }));
    expect(out).toMatch(/ENTRYPOINT_BARE_POOL\tworker.ts:6/);
  });

  it('has nothing to say about a table the schema declares without a tenant column', () => {
    const { out, code } = run(fixture({ 'worker.ts': GLOBAL_TABLE }));
    expect(out).not.toMatch(/ENTRYPOINT_BARE_POOL/);
    expect(code).toBe(0);
  });

  it('screens every named entry point, not just the worker', () => {
    for (const file of ['realtime.ts', 'instrumentation.ts', 'scripts/cron-scheduler.ts']) {
      const { out } = run(fixture({ [file]: BARE_INSERT }));
      expect(out, file).toMatch(new RegExp(`ENTRYPOINT_BARE_POOL\\t${file.replace('.', '\\.')}:5`));
    }
  });

  it('leaves the same statement in a lib file alone — this rule is about the process boundary', () => {
    const { out } = run(fixture({ 'lib/some-job-helper.ts': BARE_INSERT }));
    expect(out).not.toMatch(/ENTRYPOINT_BARE_POOL/);
  });
});

describe('the rule is a ratchet like the one above it', () => {
  it('a baseline entry tolerates the site, exactly once per statement', () => {
    const site = fixture({ 'worker.ts': BARE_INSERT }, {
      'worker.ts|ENTRYPOINT_BARE_POOL': 1,
      _reasons: { 'worker.ts|ENTRYPOINT_BARE_POOL': '#9999 tracked by the owner' },
    });
    expect(run(site, ['--baseline', 'scripts/rls-preauth-baseline.json']).code).toBe(0);
  });

  it('a second un-contexted write past the allowance is a finding again', () => {
    const two = `${BARE_INSERT}\nawait db.insert(notifications).values({ userId: 1, tenantId: 2, title: 'again' });\n`;
    const site = fixture({ 'worker.ts': two }, {
      'worker.ts|ENTRYPOINT_BARE_POOL': 1,
      _reasons: { 'worker.ts|ENTRYPOINT_BARE_POOL': '#9999 tracked by the owner' },
    });
    expect(run(site).out).toMatch(/ENTRYPOINT_BARE_POOL\tworker.ts:7/);
  });

  it('an allowance whose site is gone is stale — #3290 fixing worker.ts must retire its entry', () => {
    const site = fixture({ 'worker.ts': IN_CONTEXT }, {
      'worker.ts|ENTRYPOINT_BARE_POOL': 1,
      _reasons: { 'worker.ts|ENTRYPOINT_BARE_POOL': '#9999 tracked by the owner' },
    });
    expect(run(site).out).toMatch(/BASELINE_STALE\tworker.ts/);
  });
});

describe('the repository as it stands', () => {
  it('passes the screen, with the entry points counted', () => {
    expect(real.out).toMatch(/4 process entry point\(s\) touch no tenant-scoped table/);
    expect(real.code).toBe(0);
  });

  it('explains rule 3 to whoever it next fails', () => {
    const { out } = run(ROOT, ['--explain']);
    expect(out).toMatch(/ENTRYPOINT_BARE_POOL\s+\(rule 3\)/);
    expect(out).toMatch(/job payload is only ever a claim/);
  });
});
