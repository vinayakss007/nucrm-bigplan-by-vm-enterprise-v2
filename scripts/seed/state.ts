/**
 * #3282 — `npm run db:state`: the read-only answer to the question `prod:seed` used to gamble on.
 *
 * The issue's ask was to make "may I run the seed against this database?" a question with an
 * answerable precondition. It was not answerable before: the only way to find out what a
 * destructive script was about to do was to run it, and `scripts/seed-fresh.ts` deleted the
 * identity layer as its first act.
 *
 * This probe is keyed on the *identity* of the fixtures rather than on their ids, because the two
 * seeds in this repository are not shaped the same way: `scripts/seed-dev.ts` writes fixed ids out
 * of `IDS` (`10000000-0000-…-0001`), while `scripts/seed-fresh.ts` lets PostgreSQL generate uuids
 * and only names the tenant `nucrm-demo-<timestamp>` and the admin `admin@nucrm.com`. An id-based
 * probe would call a seed-fresh database POPULATED, and the whole point of sharing `classify()`
 * with #3281 is that there is exactly one definition of that word in this repository.
 *
 * Read-only by construction — one SELECT, no semicolon, no second statement — and it has to be run
 * with `set_config('app.is_super_admin','true',true)`, for the reason #3280 established: as the
 * bare app role under FORCE RLS every count comes back 0 and a full production database reads as
 * EMPTY. `scripts/db-state.ts` does exactly that, inside a read-only transaction.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */

import { classify, type SeedCounts, type Verdict } from './contents';

/**
 * The five counts `classify()` wants. `$`-free on purpose: the fixture identities are this
 * repository's own literals, not user input, and a verifier that takes parameters can be pointed
 * at something else.
 */
export const STATE_SQL = `
SELECT (SELECT count(*) FROM users)::int                                  AS users,
       (SELECT count(*) FROM users WHERE is_super_admin)::int             AS super_admins,
       (SELECT count(*) FROM tenants)::int                                AS tenants,
       (SELECT count(*) FROM tenants
         WHERE slug LIKE 'nucrm-demo-%'
            OR id = '10000000-0000-0000-0000-000000000001')::int           AS demo_tenant,
       (SELECT count(*) FROM users
         WHERE email = 'admin@nucrm.com'
            OR email LIKE '%@test.com')::int                               AS demo_users`

/** The probe's row shape, before it is camel-cased into `SeedCounts`. */
export interface StateRow {
  readonly users?: number | string | null;
  readonly super_admins?: number | string | null;
  readonly tenants?: number | string | null;
  readonly demo_tenant?: number | string | null;
  readonly demo_users?: number | string | null;
}

/** `pg` types a PostgreSQL `count` as a string unless the driver narrowed it; both are handled. */
export function readStateCounts(rows: readonly StateRow[]): SeedCounts {
  const row = rows[0] ?? {};
  const num = (v: number | string | null | undefined) => (typeof v === 'number' ? v : Number(v) || 0);
  return {
    users: num(row.users),
    superAdmins: num(row.super_admins),
    tenants: num(row.tenants),
    demoTenant: num(row.demo_tenant),
    demoUsers: num(row.demo_users),
  };
}

/**
 * The line an operator acts on: which command is safe against this database, in these counts.
 * Nothing here runs anything, and no branch tells the reader to delete — that is the caller's
 * gate (`destructive.ts`), not a verifier's advice.
 */
export function nextStep(verdict: Verdict): string {
  const c = verdict.counts;
  switch (verdict.state) {
    case 'EMPTY':
      return (
        'nothing in it: `npm run db:seed` (dev fixtures, idempotent) or ' +
        '`npm run db:seed:from-empty` (the first-admin provisioning path) are both safe here.'
      );
    case 'SEEDED':
      return (
        `already seeded — ${c.users} fixture user(s) and ${c.demoTenant} fixture tenant(s) are what ` +
        'the seeds write. `npm run db:seed` re-runs idempotently (#2628); `db:seed:from-empty` would ' +
        'take this layer away and re-plant it, which is what its --yes gate is for.'
      );
    case 'POPULATED':
      return (
        `this database holds rows the seeds did not write (${c.users} user(s) across ${c.tenants} ` +
        'tenant(s)). Take a backup first — then no seed, drop or restore should be run against it ' +
        'without the explicit --yes, and `db:reset` should not be run against it at all.'
      );
  }
}

/** Re-exported so a caller cannot drift onto a second copy of the verdict rules. */
export { classify };
export type { SeedCounts, Verdict };
