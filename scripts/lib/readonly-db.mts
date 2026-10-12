/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared read-only DB session for the operational probe scripts.
 *
 * Why this exists: inspecting preprod used to mean writing a throwaway .mjs,
 * `docker cp`-ing it into the app container (so `pg` would resolve), and
 * hand-rolling the four `set_config` calls. Two things went wrong with that.
 * The throwaway scripts died in /tmp and had to be re-derived every session,
 * and the GUC setup was copy-pasted, so a probe could quietly disagree with
 * what the application actually sees.
 *
 * This helper pins the probe to the SAME contract as `lib/db/pool.ts`, which
 * resets these four GUCs on every checkout (see pool.ts:233):
 *
 *   app.current_tenant   ''       ← why bare-pool INSERTs fail RLS: '' is
 *                                   NULLIF'd to NULL by the policy
 *   app.current_user     ''
 *   app.is_super_admin   'false'
 *   app.auth_lookup      ''
 *
 * A probe therefore behaves like the app unless it opts into a different
 * context explicitly. That distinction is the whole point: the RLS bug class
 * we chased repeatedly (six cron jobs reading zero rows, the super admin panel
 * reading 0 of ~190 tenant_members rows) is invisible to a probe that sets a
 * friendly tenant by default. Use `--as-role app` to see what the app sees,
 * `--tenant <uuid>` to see one tenant, `--superadmin` to see the escape hatch.
 *
 * SAFETY — non-negotiable, enforced here rather than trusted to callers:
 * - every statement runs inside one explicit transaction declared READ ONLY,
 *   so Postgres itself refuses writes, including writes from inside a
 *   SECURITY DEFINER function called by the query;
 * - the transaction is ALWAYS rolled back, even on error;
 * - GUCs are set with `set_config(..., true)` (transaction-local), never
 *   SESSION scope, so a leaked connection cannot carry a tenant context into
 *   the next probe;
 * - GUC values are bound as parameters, so a crafted `--tenant` string cannot
 *   inject SQL.
 *
 * There is deliberately no write mode. Schema changes go through
 * `npm run db:migrate`, which journals and reviews them.
 */
import { Client } from 'pg';
import { pgSslConfig } from '../../lib/db/ssl-config';

/** Exactly the GUCs `lib/db/pool.ts` pins on checkout — no others. */
export interface SessionContext {
  /** app.current_tenant — a tenant uuid. Omit to keep the app's own '' (RLS-blind). */
  tenant?: string;
  /** app.current_user — a user uuid. */
  user?: string;
  /** app.is_super_admin — true enables the escape branch where a policy has one. */
  superAdmin?: boolean;
  /** app.auth_lookup — set by the auth lookup path only. */
  authLookup?: string;
}

const POOL_DEFAULTS: Required<Omit<SessionContext, 'authLookup'>> & { authLookup: string } = {
  tenant: '',
  user: '',
  superAdmin: false,
  authLookup: '',
};

export interface OpenOptions {
  /**
   * Alternate connection string. Resolution order when omitted:
   * PROBE_DATABASE_URL then DATABASE_URL.
   *
   * PROBE_DATABASE_URL exists because the two ways of reaching this database
   * are not equivalent. The deployed app connects to pgbouncer inside the docker
   * network with DATABASE_SSL=false; .env.local's DATABASE_URL is the managed
   * provider's PUBLIC endpoint with `sslmode=require`, which node-postgres v8
   * aliases to verify-full — and the provider certificate chain is self-signed,
   * so a host-side probe fails TLS before it ever asks a question. Point
   * PROBE_DATABASE_URL at the loopback pgbouncer (deploy/ publishes 6432 on
   * 127.0.0.1) and the probe shares the app's exact posture: same database,
   * same proxy, TLS unnecessary on loopback.
   */
  connectionString?: string;
}

/**
 * Strip any `sslmode` from a connection string.
 *
 * `lib/db/ssl-config.ts` exists so that ONE policy decides whether a Postgres
 * connection verifies certificates. A `sslmode=` URL param defeats it: v8
 * treats require/verify-ca/verify-full as aliases for verify-full and lets the
 * param override the `ssl` option the app passes. scripts/preflight.ts already
 * calls this out (#1474, #1971) and asks for the param to be dropped. Probes
 * drop it here rather than fight it, so what they connect with is exactly what
 * pgSslConfig() says — no silent divergence between probe and app.
 */
function withoutUrlSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (!url.searchParams.has('sslmode')) return connectionString;
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    // Not a URL (e.g. a libpq keyword string). Leave it alone — pgSslConfig()
    // still supplies the ssl option, and inventing a parser here would be the
    // kind of quiet divergence this function exists to prevent.
    return connectionString;
  }
}

/**
 * Run `fn` inside a READ ONLY, always-rolled-back transaction with the given
 * GUC context applied. Returns whatever `fn` returns.
 */
export async function withReadonlySession<T>(
  ctx: SessionContext,
  fn: (client: Client) => Promise<T>,
  opts: OpenOptions = {},
): Promise<T> {
  const raw = opts.connectionString ?? process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'No connection string. Set PROBE_DATABASE_URL (recommended: the loopback pgbouncer)\n' +
        'or DATABASE_URL, and run through an npm script that loads .env.local, e.g.\n' +
        '  npm run probe:sql -- "select 1"',
    );
  }
  const connectionString = withoutUrlSslMode(raw);

  const resolved: SessionContext = { ...POOL_DEFAULTS, ...ctx };
  const client = new Client({
    connectionString,
    ssl: pgSslConfig() as never,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
    application_name: 'nucrm-probe',
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    // Belt and braces: READ ONLY is also re-asserted per transaction below, but
    // setting it before any statement means even the first query is guarded.
    await client.query('SET LOCAL TRANSACTION READ ONLY');
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true),
              set_config('app.current_user', $2, true),
              set_config('app.is_super_admin', $3, true),
              set_config('app.auth_lookup', $4, true)`,
      [
        resolved.tenant ?? '',
        resolved.user ?? '',
        resolved.superAdmin ? 'true' : 'false',
        resolved.authLookup ?? '',
      ],
    );
    const result = await fn(client);
    // The read-only transaction has already refused any write; the rollback is
    // the second lock, so a probe cannot leave a single row behind even if the
    // READ ONLY guard were somehow bypassed.
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    // Roll back first so the error the caller sees is the query's error.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}
