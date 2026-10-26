/**
 * #3282 — the gate a destructive database script has to pass before it touches anything.
 *
 * `scripts/seed-fresh.ts` (`npm run prod:seed`) deleted `sessions`, `tenantMembers`,
 * `dealStages`, `pipelines`, `roles`, `users` and `tenants` from whatever `DATABASE_URL` named,
 * then planted a platform super admin whose password was committed to this public repository.
 * `scripts/drop-all.ts` (`npm run db:drop`, and `npm run db:reset`) is worse and says so louder:
 * `DROP SCHEMA public CASCADE` takes the whole database with it. Neither had a confirmation, a
 * `--dry-run`, or a production check — and the name `prod:seed` is the reason nobody expected to
 * need one.
 *
 * What a gate here has to be able to say, in order:
 *
 *  1. **which database** — the operator must see `host:port/dbname` before, not after. Never the
 *     credential embedded in the URL: `DATABASE_URL` carries a password, and this string ends up
 *     in terminals, CI logs and pasted screenshots (#2302 removed the last live login this
 *     repository published).
 *  2. **what is in it** — delegated to `contents.ts`, because `NODE_ENV` and the host name are
 *     the signals #3281 proved were wrong: `.env.example` ships `NODE_ENV=development`, and
 *     `deploy/LAUNCH_RUNBOOK.md` §1 puts the production data tier on `127.0.0.1`, so a VM and a
 *     laptop are indistinguishable to a host test.
 *  3. **whether a human actually said so** — `--yes` / `-y` / `--confirm`, the flag convention
 *     `scripts/migrate.ts:42` and `scripts/rollback-migration.ts:25` already trained this
 *     repository on, plus an env opt-in for the case where the flag is not reachable.
 *
 * Two rules are deliberately harsher than "ask the human":
 *
 *  - a non-interactive run needs the flag. `readline` in CI does not fail, it hangs until the job
 *     times out, which is not a gate — that is `scripts/migrate.ts:161-176`'s finding, reused.
 *  - a whole-schema `DROP` needs the flag even with a human at the keyboard, because the count it
 *     would otherwise lean on is the very thing #3280 showed can read `EMPTY` while the database
 *     is full: under FORCE RLS an unprivileged count returns 0, so for a wipe, counting is not
 *     evidence and only an explicit act is.
 *
 * Everything here is pure — no `process`, no `pg` — so the decision table is testable without a
 * database, which is the only way to test a refusal at all.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */

import type { DatabaseState } from './contents';

/** The three parts of a target an operator can recognise, and nothing else. */
export interface Target {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

/** The opt-in for the seed that deletes the identity layer. Read literally by seed-fresh.ts. */
export const PROD_SEED_OPT_IN_ENV = 'NUCRM_ALLOW_PROD_SEED';

/** The opt-in for the script that drops the schema. Read literally by drop-all.ts. */
export const DROP_OPT_IN_ENV = 'NUCRM_ALLOW_DROP';

/**
 * `host` / `port` / `database` only. Deliberately not `URL`: keeping the parsed pieces as strings
 * makes it structurally impossible to print the credential, and `toString()` on a `URL` puts it
 * straight back. Returns `null` rather than guessing when the string is absent, not a PostgreSQL
 * URL, or names no database — a gate that invents a target is a gate that runs against the wrong
 * one.
 */
export function describeTarget(connectionString: string | undefined | null): Target | null {
  if (!connectionString) return null;
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') return null;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const host = parsed.hostname;
  if (!host || !database) return null;
  return { host, port: parsed.port || '5432', database };
}

/** What a refusal line and the pre-flight banner print. Never includes a credential. */
export function formatTarget(target: Target | null): string {
  if (!target) return '<DATABASE_URL unset or unparseable>';
  return `${target.host}:${target.port}/${target.database}`;
}

export interface GateFlags {
  readonly yes: boolean;
  readonly dryRun: boolean;
}

/** Same flag spellings as `scripts/migrate.ts` and `scripts/rollback-migration.ts`. */
export function parseFlags(argv: readonly string[]): GateFlags {
  const has = (...names: string[]) => argv.some((a) => names.includes(a));
  return {
    yes: has('--yes', '-y', '--confirm'),
    dryRun: has('--dry-run', '-n', '--dry-run=false'),
  };
}

export interface GateInput {
  /** Which script is asking, so a log line is attributable. */
  readonly script: string;
  /** What it destroys, in the operator's words. Appears in every refusal. */
  readonly effect: string;
  readonly target: Target | null;
  readonly state: DatabaseState;
  readonly production: boolean;
  /** `--yes` / `--confirm` / the env opt-in. Any one of them. */
  readonly yes: boolean;
  /** stdin is a TTY and this is not CI — i.e. a human could actually be asked. */
  readonly interactive: boolean;
  /** Drops a schema or a database: no count can be trusted as evidence. */
  readonly wipe: boolean;
}

/**
 * The refusal, or `null` when the script may proceed — which still leaves the typed confirmation
 * to the caller, because only the caller can read stdin.
 *
 * Order matters and is pinned by the tests: an unnameable target outranks everything (nothing else
 * is knowable without it), production outranks a wipe, and a wipe outranks the contents, because a
 * wipe destroys rows the contents check cannot see.
 */
export function refusal(g: GateInput): string | null {
  const where = `${g.script} → ${formatTarget(g.target)}`;
  if (!g.target) {
    return (
      `REFUSING TO RUN: ${g.script} cannot gate a database it cannot name. ` +
      '`DATABASE_URL` is unset or is not a PostgreSQL URL it can read, and a destructive script ' +
      'that guesses its target is worse than one that refuses. Set DATABASE_URL to the database ' +
      'you mean (see .env.example) and run it again.'
    );
  }
  if (g.production && !g.yes) {
    return (
      `REFUSING TO RUN: ${where} — NODE_ENV=production, and ${g.script} ${g.effect}. ` +
      `Re-run with --yes (or set ${PROD_SEED_OPT_IN_ENV}=1 / ${DROP_OPT_IN_ENV}=1) if you mean this ` +
      'particular database. Nothing has been read or written.'
    );
  }
  if (g.wipe && !g.yes) {
    return (
      `REFUSING TO RUN: ${where} — ${g.script} ${g.effect}, and a wipe of that size cannot be ` +
      'verified by counting first: under FORCE RLS an unprivileged count returns 0 on a database ' +
      'that is full (#3280), so an empty-looking target is not evidence that it is one. Typing the ' +
      'database name is not enough either. Re-run with --yes ' +
      `(or set ${DROP_OPT_IN_ENV}=1) when you have a backup.`
    );
  }
  if (g.state === 'POPULATED' && !g.yes) {
    return (
      `REFUSING TO RUN: ${where} — the target reports POPULATED, i.e. it holds rows this script did ` +
      `not write, and ${g.script} ${g.effect}. Re-run with --yes (or set ${PROD_SEED_OPT_IN_ENV}=1) ` +
      'only after a backup: `npm run db:state` prints the counts this decision was made from.'
    );
  }
  if (!g.yes && !g.interactive) {
    return (
      `REFUSING TO RUN: ${where} — ${g.script} ${g.effect} and cannot ask for confirmation in a ` +
      'non-interactive context. A prompt that nobody is there to answer does not gate anything, it ' +
      'hangs the job. Re-run with --yes ' +
      `(or set ${PROD_SEED_OPT_IN_ENV}=1 / ${DROP_OPT_IN_ENV}=1) to proceed deliberately.`
    );
  }
  return null;
}

/**
 * The interactive half: the operator types the database name they were just shown. Enter alone,
 * `y`, and anything else are all refusals — the point is that the name in the prompt was read, not
 * that a key was pressed. Compared exactly (whitespace trimmed) and case-sensitively; an empty
 * expectation is never satisfiable, so a script that lost its target cannot confirm itself.
 */
export function confirmationMatches(expected: string, typed: string): boolean {
  const want = expected.trim();
  if (!want) return false;
  return typed.trim() === want;
}
