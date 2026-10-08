/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public-write row-projection guard (#2440).
 *
 * Every exported handler under `app/api/public/**` that writes must name the
 * columns it returns: `.returning({...})`, never `.returning()`.
 *
 * An argument-less `.returning()` is `RETURNING *` — the response body is
 * whatever the table happens to hold, now and after any later migration.
 * `app/api/public/tickets/route.ts` did exactly that, so the anonymous ticket
 * embed received the `portal_token` the handler had just minted: a bearer
 * credential that `GET /api/public/tickets` accepts, and that grants the
 * contact's whole ticket history including free-text bodies. #2217 had already
 * redacted that column from the customer-facing detail response; the create
 * path was never covered, and nothing would have covered it, because the
 * leaking field was not chosen — it was inherited from the table definition.
 *
 * So the rule is structural rather than about this one column: a public handler
 * must decide, in code, which fields leave the database. Adding a sensitive
 * column to `support_tickets` (or `ticket_replies`, or any table a public route
 * writes) must not be able to widen a response by itself.
 *
 * Scope, deliberately:
 *  - Only `app/api/public/**`. Staff routes echo whole rows to authenticated
 *    agents and that is a different trust decision.
 *  - Only writes. Unprojected *reads* (`db.select()` with no column list) are
 *    the same class and the public detail route still has one; that is tracked
 *    separately and gets its own fix, rather than being pinned into a baseline
 *    here.
 *
 * Conventions match the guard family (`check-public-rate-limit.mts`,
 * `check-portal-soft-delete.mts`): pure exported functions so a unit test can
 * plant a violation, `--json`, non-zero exit naming `file:line`, and a
 * discovery floor so a walk that finds nothing fails instead of printing OK.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

export type Finding = {
  file: string;
  line: number;
  verb: string;
  detail: string;
};

/**
 * A guard that silently finds no handlers is worse than no guard: it reports
 * clean. The public tree has 14 route files and several writes; anything under
 * this is a broken walk, not a clean codebase.
 */
export const MIN_PUBLIC_WRITE_SITES = 2;

export type WriteSite = {
  file: string;
  verb: string;
  line: number;
  /** true when `.returning` is called with no column selection */
  unprojected: boolean;
};

const VERB_RE = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m;

/** Slice a route module into its exported handlers, same textual rule as the rate-limit guard. */
export function enumerateHandlers(source: string, file: string): { file: string; verb: string; line: number; body: string }[] {
  const lines = source.split('\n');
  const starts: { line: number; verb: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = VERB_RE.exec(lines[i]);
    if (m) starts.push({ line: i, verb: m[1] });
  }
  return starts.map((s, idx) => ({
    file,
    verb: s.verb,
    line: s.line + 1,
    body: lines.slice(s.line, starts[idx + 1] ? starts[idx + 1].line : lines.length).join('\n'),
  }));
}

/**
 * `.returning()` vs `.returning({...})`. The `{` may sit on the same line or the
 * next, and an empty `returning({})` is as unprojected as no argument at all, so
 * the brace is required to hold at least one character of selection.
 */
/**
 * Blank out line and block comments while preserving every newline, so a
 * handler's prose cannot be mistaken for its code: the comments that explain
 * this rule literally quote an argument-less returning call.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out.push(' ', ' '); i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out.push(' ', ' '); i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'string'; quote = c; }
      out.push(c);
      i++;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out.push(c); } else out.push(' ');
      i++;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out.push(' ', ' '); i += 2; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    // inside a string literal: keep it verbatim, it cannot hold a real call
    out.push(c);
    if (c === '\\' && next !== undefined) { out.push(next); i += 2; continue; }
    if (c === quote) mode = 'code';
    i++;
  }
  return out.join('');
}

export function findWriteSites(body: string, file: string, verb: string, line: number): WriteSite[] {
  const code = stripComments(body);
  const out: WriteSite[] = [];
  const re = /\.returning\s*\(\s*/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const after = code.slice(m.index + m[0].length);
    const closeBrace = after.indexOf('}');
    const selection = after.startsWith('{')
      && closeBrace !== -1
      && after.slice(1, closeBrace).replace(/\s/g, '').length > 0;
    out.push({
      file,
      verb,
      line: line + code.slice(0, m.index).split('\n').length - 1,
      unprojected: !selection,
    });
  }
  return out;
}

export function findings(sites: WriteSite[]): Finding[] {
  return sites.filter((s) => s.unprojected).map((s) => ({
    file: s.file,
    line: s.line,
    verb: s.verb,
    detail: 'a public handler returns an unprojected .returning() — this is RETURNING *, so the '
      + 'response widens by itself the moment the table gains a column. Name the columns: '
      + '.returning({ id: table.id, ... }). See #2440: this is how portal_token reached an anonymous caller.',
  }));
}

export function walkRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`${dir} is missing — cannot audit public route projections`);
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkRouteFiles(full));
    else if (ent.name === 'route.ts') out.push(full);
  }
  return out.sort();
}

export type RunResult = { files: number; writes: number; problems: Finding[] };

export function run(root = '.', opts: { sites?: WriteSite[]; dirs?: string[] } = {}): RunResult {
  let sites = opts.sites;
  if (!sites) {
    sites = [];
    let files = 0;
    for (const rel of opts.dirs ?? [join('app', 'api', 'public')]) {
      const dir = isAbsolute(rel) ? rel : join(root, rel);
      for (const file of walkRouteFiles(dir)) {
        files++;
        const abs = readFileSync(file, 'utf8');
        for (const h of enumerateHandlers(abs, relative(root, file).split('\\').join('/'))) {
          sites.push(...findWriteSites(h.body, h.file, h.verb, h.line));
        }
      }
    }
    if (!opts.dirs && files === 0) throw new Error('no route.ts found under app/api/public — nothing audited');
    if (sites.length < MIN_PUBLIC_WRITE_SITES) {
      throw new Error(
        `found only ${sites.length} public write site(s); expected at least ${MIN_PUBLIC_WRITE_SITES} — `
        + 'the insert chain was not matched, so this run proves nothing',
      );
    }
  }
  return { files: new Set(sites.map((s) => s.file)).size, writes: sites.length, problems: findings(sites) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dirs = args.filter((a) => !a.startsWith('-'));
  const result = run('.', dirs.length ? { dirs } : {});

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.problems.length === 0) {
    process.stdout.write(
      `[check-public-row-projection] OK — ${result.writes} public write site(s) across `
      + `${result.files} route file(s), every one naming the columns it returns.\n`,
    );
  } else {
    process.stdout.write(`[check-public-row-projection] ${result.problems.length} violation(s):\n`);
    for (const f of result.problems) {
      process.stdout.write(`  ${f.file}:${f.line} ${f.verb} — ${f.detail}\n`);
    }
  }
  process.exit(result.problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].includes('check-public-row-projection')) {
  main().catch((err: unknown) => {
    process.stderr.write(`[check-public-row-projection] ${(err as Error).message}\n`);
    process.exit(2);
  });
}
