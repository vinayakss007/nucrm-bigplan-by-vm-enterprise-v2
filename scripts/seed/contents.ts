/**
 * #3281 — decide what a seed script is about to touch from the DATA, not from the
 * caller's environment.
 *
 * `scripts/seed-dev.ts` has refused to run since #2628 when `NODE_ENV === 'production'`
 * and when `DATABASE_URL` does not look local. Both signals are the wrong ones:
 * `.env.example` ships `NODE_ENV=development` and the host install copies that template
 * (#3279 is the same class of bug on `TRUST_PROXY`), while `deploy/LAUNCH_RUNBOOK.md` §1
 * requires the production data tier to listen on `127.0.0.1` — so a production VM and a
 * laptop answer the host test with the same string. On the box where the damage would be
 * irreversible, both guards pass and the seed runs.
 *
 * "Is this my throwaway database, or the real tenant's?" is a question about contents:
 * does `users` already have rows, does a platform super admin already exist, is the only
 * tenant the demo one. This module answers it from counts, and `refusal()` says what a
 * seed script must do about the answer.
 *
 * Read-only by construction: `COUNTS_SQL` is a single SELECT, and #3280 is the reason it
 * has to be run inside the caller's `app.is_super_admin` context — counting rows as the
 * bare app role under FORCE RLS silently returns 0 and would call a populated production
 * database EMPTY.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */

export interface SeedCounts {
  readonly users: number;
  readonly superAdmins: number;
  readonly tenants: number;
  readonly demoTenant: number;
  readonly demoUsers: number;
}

export type DatabaseState = 'EMPTY' | 'SEEDED' | 'POPULATED';

export interface Verdict {
  readonly state: DatabaseState;
  readonly counts: SeedCounts;
  readonly reasons: readonly string[];
}

/**
 * The probe. `$1` is the demo tenant id, `$2` the demo user ids. Every column is a
 * scalar count so the caller never has to trust a table-wide estimate.
 */
export const COUNTS_SQL = `
SELECT (SELECT count(*) FROM users)::int                        AS users,
       (SELECT count(*) FROM users WHERE is_super_admin)::int   AS super_admins,
       (SELECT count(*) FROM tenants)::int                       AS tenants,
       (SELECT count(*) FROM tenants WHERE id = $1)::int         AS demo_tenant,
       (SELECT count(*) FROM users
         WHERE id = ANY($2::uuid[]))::int                        AS demo_users`;

/** Pure: the same counts always give the same verdict, which is what makes it testable. */
export function classify(counts: SeedCounts): Verdict {
  const reasons: string[] = [];
  if (counts.users === 0 && counts.tenants === 0) {
    return { state: 'EMPTY', counts, reasons: ['no users and no tenants — a virgin database'] };
  }
  if (counts.demoTenant === 1 && counts.tenants === 1 && counts.demoUsers === counts.users && counts.users > 0) {
    reasons.push(`the only tenant is the demo one, and all ${counts.users} user(s) are the seeded fixtures`);
    if (counts.superAdmins > 0) {
      reasons.push(`${counts.superAdmins} platform super admin(s) already exist — the one-shot bootstrap in app/api/setup/create-admin/route.ts:43-46 is spent`);
    }
    return { state: 'SEEDED', counts, reasons };
  }
  reasons.push(`${counts.users} user(s) across ${counts.tenants} tenant(s), of which ${counts.demoUsers} user(s) and ${counts.demoTenant} tenant(s) are the seed's own fixtures`);
  if (counts.superAdmins > 0) reasons.push(`${counts.superAdmins} platform super admin(s) already exist`);
  reasons.push('this database holds rows the seed did not write');
  return { state: 'POPULATED', counts, reasons };
}

/**
 * What a seed script must do with a verdict. Only `POPULATED` is refused: an empty
 * database is what the seed is for, and a database carrying exactly its own fixtures
 * is the idempotent re-run #2628 made it safe to repeat.
 *
 * The override is a boolean argument, not a `process.env` lookup inside this module:
 * `scripts/check-env-coverage.mjs:71-75` only recognises a name written next to
 * `process.env.`, and the caller reading it explicitly is what puts
 * `SEED_ALLOW_POPULATED` in that guard's field of view — the same treatment
 * `SEED_ALLOW_REMOTE` already gets (#2596).
 */
export function refusal(verdict: Verdict, allowPopulated = false): string | null {
  if (verdict.state !== 'POPULATED') return null;
  if (allowPopulated) return null;
  return (
    'REFUSING TO SEED: the target database is not one this script owns. ' +
    `${verdict.reasons[0]}. ` +
    '`seed:dev` DELETEs the demo tenant\'s rows and writes a platform super admin, and the ' +
    'NODE_ENV / localhost guards do not distinguish a production VM from a laptop (#3281). ' +
    'Point DATABASE_URL at a throwaway database, or set SEED_ALLOW_POPULATED=true if you ' +
    'really mean it.'
  );
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, number | null>[] }>;
}

/** Runs the probe on the caller's connection — which must already carry the RLS context. */
export async function probeCounts(client: Queryable, tenantId: string, userIds: readonly string[]): Promise<SeedCounts> {
  const { rows } = await client.query(COUNTS_SQL, [tenantId, userIds]);
  const row = rows[0] ?? {};
  const num = (v: number | null | undefined) => (typeof v === 'number' ? v : Number(v) || 0);
  return {
    users: num(row.users),
    superAdmins: num(row.super_admins),
    tenants: num(row.tenants),
    demoTenant: num(row.demo_tenant),
    demoUsers: num(row.demo_users),
  };
}

/** One line, in the shape `npm run db:state` prints, for the seed's own log. */
export function formatVerdict(verdict: Verdict): string {
  const c = verdict.counts;
  return `data        users=${c.users} superAdmins=${c.superAdmins} tenants=${c.tenants} demoFixtures=${c.demoUsers}/${c.demoTenant}  [${verdict.state}]`;
}
