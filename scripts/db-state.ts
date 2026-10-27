/**
 * #3282 — `npm run db:state`: what is in the database DATABASE_URL points at, read-only.
 *
 * The issue's ask was to turn "may I run the seed against this?" into a question with an answer.
 * Before this revision the only way to find out was to run the destructive command — and
 * `scripts/seed-fresh.ts` deleted the identity layer as its first act, so the answer arrived after
 * the damage.
 *
 * It is a verifier, so it writes nothing: one transaction, `SET TRANSACTION READ ONLY`,
 * two SELECTs (`STATE_SQL` and, since #3302, the whole-population FORCE RLS census), and
 * a `ROLLBACK` that undoes nothing but guarantees the bypass GUC set with
 * `SET LOCAL` dies with the transaction instead of leaking to the next checkout of this pooled
 * connection.
 *
 * The GUC is not optional. Counted as the bare app role under FORCE RLS, every table answers 0
 * (#3280), and this screen would have told an operator that a full production database is empty —
 * which is the sentence a destructive script waits on.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool } from 'pg';

import { classify, formatVerdict } from './seed/contents';
import { describeTarget, formatTarget } from './seed/destructive';
import { STATE_SQL, readStateCounts, nextStep } from './seed/state';
import {
  FULL_FORCE_RLS_CENSUS_SQL,
  evaluateForceRlsCensus,
  formatForceRlsCensus,
} from '../lib/db/least-privilege';

async function main() {
  const target = describeTarget(process.env.DATABASE_URL);
  if (!target) {
    console.error('[db:state] DATABASE_URL is unset or is not a PostgreSQL URL — refusing to guess which database to look at.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SELECT set_config('app.is_super_admin', 'true', true)`);
    const { rows } = await client.query(STATE_SQL);
    // #3302: the counts above answer "is there data in here", and nothing on this
    // screen answered "is every table's RLS actually binding" — the two existing RLS
    // reports select tables by a uuid `tenant_id` column, so `ai_providers` was outside
    // their denominator. Reported, not gated: this is a verifier, and its exit code is
    // about whether a seed is safe here, which a missing FORCE does not change.
    const census = evaluateForceRlsCensus((await client.query(FULL_FORCE_RLS_CENSUS_SQL)).rows);
    await client.query('ROLLBACK');

    const verdict = classify(readStateCounts(rows));
    console.log(`[db:state] target  ${formatTarget(target)}`);
    console.log(`[db:state] ${formatVerdict(verdict)}`);
    for (const reason of verdict.reasons) console.log(`[db:state]   - ${reason}`);
    console.log(`[db:state] rls     ${formatForceRlsCensus(census)}`);
    console.log(`[db:state] next    ${nextStep(verdict)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[db:state] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
