#!/usr/bin/env node
/**
 * #3282 — `DROP SCHEMA public CASCADE` now needs the operator to say so.
 *
 * This was 28 lines that read `DATABASE_URL`, connected to it, and dropped `public` and `drizzle`
 * with CASCADE — no `NODE_ENV` check, no confirmation, no `--dry-run`, no printed target. Two
 * package.json aliases reach it (`db:drop`, and `db:reset` which drops then re-migrates), and both
 * are named in the runbook tables an operator follows under time pressure.
 *
 * The gate is `scripts/seed/destructive.ts` with `wipe: true`. For a wipe the flag is the only
 * admissible evidence: #3280 is exactly the case where a count run as the bare app role answers 0
 * on a database that is full, so "it looked empty" cannot be the reason a schema gets dropped.
 * `GRANT ALL ON SCHEMA public TO public` stays — the rebuilt schema has to be usable by the app
 * role or the migration chain that follows cannot connect — but it is now inside a gated script.
 */
import { Pool } from 'pg';
import { createInterface } from 'node:readline';

import {
  describeTarget,
  formatTarget,
  parseFlags,
  refusal,
  confirmationMatches,
} from './seed/destructive';

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = describeTarget(process.env.DATABASE_URL);
  const yes = flags.yes || process.env.NUCRM_ALLOW_DROP === '1';
  const interactive = Boolean(process.stdin.isTTY) && process.env.CI !== 'true';

  const blocked = refusal({
    script: 'drop-all',
    effect: 'drops the public and drizzle schemas with CASCADE and rebuilds public',
    target,
    state: 'EMPTY',
    production: process.env.NODE_ENV === 'production',
    yes,
    interactive,
    wipe: true,
  });
  if (blocked) {
    console.error(`[drop-all] ${blocked}`);
    // Printed by the file that holds the DROPs, in the spellings this script accepts: a full
    // wipe is confirmed with --yes / --confirm, and `--dry-run` only previews it. That is also
    // what `guard:destructive-gate` reads here, so the gate cannot rot by moving into a helper.
    console.error('[drop-all] usage: npm run db:drop -- --dry-run | --yes (also -y, --confirm); NUCRM_ALLOW_DROP=1 for a non-interactive run');
    process.exit(1);
  }

  console.log(`[drop-all] target: ${formatTarget(target)} — DROP SCHEMA public, drizzle CASCADE`);

  if (!yes) {
    const typed = await ask(`Type the database name "${target!.database}" to continue: `);
    if (!confirmationMatches(target!.database, typed)) {
      console.error(`[drop-all] REFUSING: "${target!.database}" was not typed, so this run is not confirmed.`);
      process.exit(1);
    }
  }

  if (flags.dryRun) {
    console.log('[drop-all] --dry-run: nothing dropped. Re-run without it to proceed.');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('[drop-all] Dropping all schemas (public + drizzle)...');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    // The rebuilt schema has to be reachable by the app role, or every migration after
    // `db:reset` fails on permission denied rather than on the drop.
    await pool.query('GRANT ALL ON SCHEMA public TO public');
    console.log('[drop-all] All tables dropped successfully');
  } catch (error) {
    console.error('[drop-all] Failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

main();
