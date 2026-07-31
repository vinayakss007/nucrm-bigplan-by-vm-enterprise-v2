/**
 * One TLS policy for every Postgres connection this repo opens.
 *
 * Before this existed, five call sites each decided for themselves and disagreed:
 *
 *   lib/db/pool.ts          DATABASE_SSL !== 'false'   verify in production
 *   lib/db/read-replica.ts  DATABASE_SSL !== 'false'   verify in production
 *   scripts/migrate.ts      DATABASE_SSL === 'true'    never verify
 *   scripts/migration-status.ts  NODE_ENV production   never verify
 *   scripts/diagnose-production.ts  DATABASE_SSL       never verify
 *
 * Two consequences. The application verified the server certificate in production
 * while every operational script accepted any certificate -- including migrate.ts,
 * which holds the most privileged connection in the system and runs DDL. And
 * migrate.ts read the flag with inverted defaults, so with DATABASE_SSL unset the
 * app would use TLS while migrations connected in plaintext.
 *
 * Policy:
 * - TLS unless DATABASE_SSL is exactly 'false' (so it is on by default)
 * - verify the server certificate when NODE_ENV is 'production'
 * - DATABASE_SSL_REJECT_UNAUTHORIZED=false is the explicit escape hatch, for a
 *   database presenting a self-signed or otherwise untrusted certificate
 */

export type PgSslConfig = false | { rejectUnauthorized: boolean };

export function pgSslConfig(env: NodeJS.ProcessEnv = process.env): PgSslConfig {
  if (env['DATABASE_SSL'] === 'false') return false;

  const isProduction = env['NODE_ENV'] === 'production';
  const optedOutOfVerification = env['DATABASE_SSL_REJECT_UNAUTHORIZED'] === 'false';

  return { rejectUnauthorized: isProduction && !optedOutOfVerification };
}
