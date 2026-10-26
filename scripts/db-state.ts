/**
 * #3282 — `npm run db:state`: what is in the database DATABASE_URL points at, read-only.
 *
 * The issue's ask was to turn "may I run the seed against this?" into a question with an answer.
 * Before this revision the only way to find out was to run the destructive command — and
 * `scripts/seed-fresh.ts` deleted the identity layer as its first act, so the answer arrived after
 * the damage.
 *
 * It is a verifier, so it writes nothing: one transaction, `SET TRANSACTION READ ONLY`, one SELECT
 * (`STATE_SQL`), and a `ROLLBACK` that undoes nothing but guarantees the bypass GUC set with
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
    await client.query('ROLLBACK');

    const verdict = classify(readStateCounts(rows));
    console.log(`[db:state] target  ${formatTarget(target)}`);
    console.log(`[db:state] ${formatVerdict(verdict)}`);
    for (const reason of verdict.reasons) console.log(`[db:state]   - ${reason}`);
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
