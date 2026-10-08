/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2459: every row-projection comment in this class justifies itself with a
 * column count ("`api_keys` is 16 columns"), so the count is a citation and a
 * citation rots. Five of the ones shipped in #2460 were wrong.
 *
 * They were wrong the same way for the same reason: they were counted with a
 * text grep over the schema file (`^  [a-zA-Z]+:`), which cannot see a key
 * containing a digit — `users.telegramNotify2faChange` — and cannot see anything
 * a spread helper contributes, so every `...utils.lifecycle()` (createdAt,
 * updatedAt, deletedAt) went uncounted. users 32→36, tenants 31→34, roles 8→11,
 * api_keys 13→16, contacts 47→55, pipelines 6→9, plans 19→22.
 *
 * So: count from drizzle, which is what `SELECT *` actually expands to.
 * `getTableColumns` is drizzle's own view of the table, and this pins each
 * comment's wording next to the number it claims, so the two cannot drift
 * apart — change one and exactly one of the two assertions below goes red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { users, tenants, roles, apiKeys } from '@/drizzle/schema/core';
import { pipelines, contacts } from '@/drizzle/schema/crm';
import { plans } from '@/drizzle/schema/billing';
import { portalClients } from '@/drizzle/schema/tokens';

const ROOT = join(import.meta.dirname!, '..', '..');

const TABLES: Record<string, object> = {
  users, tenants, roles, api_keys: apiKeys, contacts, pipelines, plans, portal_clients: portalClients,
};

/** `[file, table, the exact phrase the comment uses]` — the phrase is matched
 *  literally so a reworded comment cannot silently keep a stale number. */
const CLAIMS: [string, string, string][] = [
  ['app/api/setup/create-admin/route.ts', 'users', '`users` is 36 columns'],
  ['app/api/setup/create-admin/route.ts', 'tenants', '`tenants` is 34 columns'],
  ['app/api/setup/create-admin/route.ts', 'roles', '`roles` is 11 columns'],
  ['app/api/setup/create-admin/route.ts', 'pipelines', '`pipelines` is 9 columns'],
  ['app/api/setup/create-admin/route.ts', 'plans', '`plans` is 22 columns'],
  ['app/api/webhooks/inbound/route.ts', 'api_keys', '`api_keys` is 16 columns'],
  ['app/api/forms/submit/route.ts', 'contacts', 'the 55 columns'],
  ['app/api/tenant/portal/login/route.ts', 'portal_clients', 'the whole 10-column row'],
];

function columnCount(table: string): number {
  const found = TABLES[table];
  if (!found) throw new Error(`no drizzle table registered for "${table}"`);
  return Object.keys(getTableColumns(found as never)).length;
}

describe('#2459 comments cite column counts drizzle agrees with', () => {
  it.each(CLAIMS)('%s cites %s', (file, table, phrase) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source, `${file} no longer says "${phrase}" — re-measure and reword together`)
      .toContain(phrase);
    const cited = Number(/(\d+)/.exec(phrase)![1]);
    expect(cited, `"${phrase}" is stale: drizzle counts ${columnCount(table)}`)
      .toBe(columnCount(table));
  });

  it('counts the credential columns the create-admin comment names', () => {
    // That comment lists six columns by their SQL names and promises
    // `RETURNING *` pulls them. Both halves have to stay true: the names must
    // exist in drizzle's view of `users`, and the comment must still name each
    // one (it wraps, so check them individually rather than as one phrase).
    const named = ['password_hash', 'email_verify_token', 'reset_token', 'telegram_bot_token', 'totp_secret', 'totp_backup_codes'];
    const dbNames = Object.values(getTableColumns(users as never)).map((c) => (c as { name: string }).name);
    const source = readFileSync(join(ROOT, 'app/api/setup/create-admin/route.ts'), 'utf8');
    for (const col of named) {
      expect(dbNames, `users has no ${col}`).toContain(col);
      expect(source, `the comment no longer names ${col}`).toContain(col);
    }
  });

  it('proves the grep method was the bug, not the schema', () => {
    // A key with a digit in it, and a spread helper, are the two shapes the old
    // count missed. If a future rewrite of this test reaches for a text scan of
    // drizzle/schema/*.ts, these two are why it may not.
    const declared = readFileSync(join(ROOT, 'drizzle/schema/core.ts'), 'utf8');
    expect(declared).toMatch(/^\s+telegramNotify2faChange:/m);
    expect(declared).toMatch(/^\s*\.\.\.utils\.lifecycle\(\),/m);
  });
});
