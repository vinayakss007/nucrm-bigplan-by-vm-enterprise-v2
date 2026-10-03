#!/usr/bin/env npx tsx
/**
 * Super-admin console sweep (#1/#31, repeatable).
 *
 * The panel is the one surface with no tenant to hide behind: every route reads
 * across all workspaces, so a single RLS or SQL-shape mistake is a 500 on the
 * admin's screen rather than on one customer's. Those regressions were found by
 * hand here, by ad-hoc throwaways that died in /tmp — which is why the sweep is
 * a tool now: it can be re-run after every deploy, and it exits non-zero on any
 * 5xx so it can become a gate the same way `guard:rls` is.
 *
 * How it authenticates: it mints a session row for the real super-admin account
 * (the same way `scripts/simulate-preprod-flows.ts` does), because there is no
 * other way in — `lib/auth/api-key.ts:112` hard-codes `isSuperAdmin: false`, so
 * no API key can ever pass a super-admin gate (#1918), and a login from a
 * harness address would be a second credential path to keep secret. The token is
 * random, stored only as its SHA-256 (matching `hashToken`), and the row is
 * deleted in a finally block.
 *
 * Usage:
 *   E2E_BASE_URL=http://nucrm-app:3000 npx tsx scripts/sweep-superadmin-get.mts
 *   npx tsx scripts/sweep-superadmin-get.mts --only tenants --json
 *   npx tsx scripts/sweep-superadmin-get.mts --keep-session   # browse the panel with it
 *
 * SAFETY: GET only. It never POSTs/PUTs/PATCHes, so it cannot mutate a tenant,
 * and a read of a dynamic route uses a real id taken from the matching list
 * endpoint (falling back to a random uuid, reported as `id=random`, which still
 * exercises the route's error path but asserts nothing about data).
 */
import { randomUUID, createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join} from 'node:path';
import { SignJWT } from 'jose';
import pg from 'pg';

const API_ROOT = 'app/api/superadmin';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] ?? '' : '';
const asJson = args.includes('--json');
const keepSession = args.includes('--keep-session');

interface Probe { path: string; route: string; idKind: 'list' | 'random' | 'none'; param: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === 'route.ts') out.push(full);
  }
  return out;
}

function hasGet(file: string): boolean {
  const text = readFileSync(file, 'utf8');
  return /export\s+const\s+GET\b/.test(text) || /export\s*\{[^}]*\bGET\b[^}]*\}/.test(text);
}

/** `/api/superadmin/tenants/[id]/roles` -> `/api/superadmin/tenants/{id}/roles` */
function toTemplate(file: string): string {
  const dir = file.replace(/^app\/api/, '/api').replace(/\/route\.ts$/, '');
  return dir === '' ? '/api' : dir;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** First id in a list response, whichever envelope the route uses. */
function firstId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ['data', 'rows', 'items', 'results', 'tenants', 'plans', 'users']) {
    const list = payload[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (isRecord(item) && typeof item['id'] === 'string' && item['id']) return item['id'];
      }
    } else if (isRecord(list) && typeof list['id'] === 'string' && list['id']) {
      return list['id'];
    }
  }
  return null;
}

async function main(): Promise<number> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  // `users` is guarded by tenant_isolation, whose policies have a
  // `app.is_super_admin` branch — and a bare connection sets none of the GUCs,
  // so this lookup returned zero rows and the sweep exited before authenticating.
  const boot = await pool.connect();
  let admin: { id: string; email: string } | null = null;
  try {
    await boot.query('BEGIN');
    await boot.query(`SELECT set_config('app.is_super_admin', 'true', true)`);
    const res = await boot.query(
      `SELECT id, email FROM users WHERE is_super_admin = true ORDER BY created_at LIMIT 1`
    );
    await boot.query('COMMIT');
    const row = res.rows[0] as { id: string; email: string } | undefined;
    if (row) admin = { id: String(row.id), email: String(row.email) };
  } catch (err) {
    await boot.query('ROLLBACK');
    boot.release();
    await pool.end();
    console.error('[sweep] could not read the super-admin account:', err instanceof Error ? err.message : err);
    return 2;
  }
  boot.release();
  if (!admin) {
    console.error('[sweep] no is_super_admin user exists — nothing to sweep as');
    await pool.end();
    return 2;
  }
  const userId = admin.id;
  // The token must be a real signed session token, not a random string:
  // `createToken` (lib/auth/session.ts:61) issues an HS256 JWT over {sub}, and
  // auth verifies the signature *first* and only then looks the row up by
  // SHA-256. A random string hashes to a matching row but fails signature
  // verification, so every probe came back 401 and the sweep tested nothing.
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('[sweep] JWT_SECRET is required to mint a session token');
    await pool.end();
    return 2;
  }
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(new TextEncoder().encode(jwtSecret));
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // sessions_user_own is FOR ALL keyed on app.current_user with no WITH CHECK,
  // so the insert needs the account's own identity, not a super-admin flag.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [userId, tokenHash]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
    console.error('[sweep] could not mint a session:', err instanceof Error ? err.message : err);
    return 2;
  }
  client.release();
  if (!asJson) {
    console.log(`[sweep] base=${BASE_URL} as super admin ${admin.email} (session minted)`);
  }

  const probes: Probe[] = [];
  for (const file of walk(API_ROOT)) {
    if (!hasGet(file)) continue;
    const template = toTemplate(file);
    if (only && !template.includes(only)) continue;
    const param = /\[([^\]]+)\]/.exec(template)?.[1] ?? '';
    probes.push({
      path: template,
      route: file,
      param,
      idKind: param ? (/\[id\]$|\[id\]\//.test(template) ? 'list' : 'random') : 'none',
    });
  }

  const results: { path: string; status: number; ms: number; idKind: string; note: string }[] = [];
  const fetchGet = async (path: string): Promise<{ status: number; body: string; ms: number }> => {
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { cookie: `nucrm_session=${token}` },
      redirect: 'manual',
    });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - t0 };
  };

  for (const probe of probes) {
    let path = probe.path;
    let idKind = probe.idKind;
    if (probe.param) {
      // The parent list endpoint gives a real id; the segment before the
      // bracketed one is that endpoint (`/tenants/[id]` -> `/tenants`).
      const parent = probe.path.replace(new RegExp(`/\\[${probe.param}\\].*$`), '');
      let real: string | null = null;
      try {
        const p = await fetchGet(parent);
        real = p.status === 200 ? firstId(JSON.parse(p.body)) : null;
      } catch { /* parent unusable — fall back below */ }
      if (real) {
        idKind = 'list';
      } else {
        idKind = 'random';
        real = randomUUID();
      }
      path = probe.path.replace(new RegExp(`\\[${probe.param}\\]`), real);
    }
    const out = await fetchGet(path);
    const note = out.status >= 500 ? out.body.replace(/\s+/g, ' ').slice(0, 160) : '';
    results.push({ path, status: out.status, ms: out.ms, idKind, note });
    if (!asJson) {
      const flag = out.status >= 500 ? 'x' : out.status >= 400 ? '!' : ' ';
      console.log(`${flag} ${String(out.status).padEnd(4)} ${String(out.ms).padStart(5)}ms  id=${idKind.padEnd(6)} ${path}${note ? `\n     ${note}` : ''}`);
    }
  }

  if (!keepSession) {
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await c2.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
      await c2.query('COMMIT');
    } catch (err) {
      await c2.query('ROLLBACK');
      console.error('[sweep] session cleanup FAILED — the minted session is still valid for 1h:',
        err instanceof Error ? err.message : err);
    }
    c2.release();
  }
  await pool.end();

  const five = results.filter((r) => r.status >= 500);
  const four = results.filter((r) => r.status >= 400 && r.status < 500);
  if (asJson) {
    console.log(JSON.stringify({ base: BASE_URL, total: results.length, fiveHundred: five, clientErrors: four, results }, null, 2));
  } else {
    console.log(`[sweep] ${results.length} GET route(s) · ${five.length} 5xx · ${four.length} 4xx · ` +
      `slowest ${Math.max(0, ...results.map((r) => r.ms))}ms`);
    if (keepSession) console.log(`[sweep] --keep-session: token ${token} (1h, user ${userId})`);
  }
  return five.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[sweep] crashed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(3);
});
