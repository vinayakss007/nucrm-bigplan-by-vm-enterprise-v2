/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public-write row-projection guard (#2440) + public-read row-projection guard (#2443).
 *
 * Every exported handler under `app/api/public/**` must name the columns it
 * moves: `.returning({...})` never `.returning()`, and `.select({...})` (or a
 * shared named projection) never `.select()`.
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
 *  - Reads are in scope as of #2443, and the rule for them is stricter than the
 *    issue asked for. #2443 AC6 offered a guard that tells apart "row returned
 *    to the client" from "row read for server-side logic", because the two
 *    public quote handlers (`accept`, `decline`) read the whole quote only to
 *    test `status`/`expiresAt` and answer `{ ok, status, accepted_at }` — the row
 *    never went out. Making that call is a dataflow guess, and a guard that
 *    guesses has to be re-guessed by the next editor: classify one read as
 *    harmless, then someone adds `return NextResponse.json({ data: quote })`
 *    fifteen lines below it and the tree is leaky while the guard prints OK. So
 *    there is no classifier. Every `.select()` under `app/api/public` names its
 *    columns, the logic-only reads included — `accept` now names the seven
 *    fields it tests or copies, `decline` the five. That also stops them
 *    fetching a row the size of the table to decide a branch. Zero exceptions,
 *    so zero baseline to pin.
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

/**
 * Same reasoning as the write floor: the public tree has sixteen `.select()`
 * calls across its route files, so a walk that turns up fewer than eight is a
 * broken regex or a broken walk, not a codebase that reads no columns.
 */
export const MIN_PUBLIC_READ_SITES = 8;

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

export type ReadSite = {
  file: string;
  verb: string;
  line: number;
  /** true when `.select` is called with no column selection */
  unprojected: boolean;
};

/**
 * `.select()` / `.select({})` vs `.select({...})` / `.select(SOME_MAP)`.
 *
 * A shared projection passed by name (`.select(PUBLIC_TICKET_COLUMNS)`, #2443)
 * counts as named: the guard's job is to force the handler to point at a
 * decision about which fields leave the database, not to keep that decision
 * spelled out at the call site. It is spelled out in
 * `lib/public-ticket-projection.ts`, whose exact key set is pinned by
 * `tests/unit/public-tickets.test.ts`.
 */
export function findReadSites(body: string, file: string, verb: string, line: number): ReadSite[] {
  const code = stripComments(body);
  const out: ReadSite[] = [];
  const re = /\.select\s*\(\s*\{?\s*/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const after = code.slice(m.index + m[0].length);
    let selection: boolean;
    if (m[0].trimEnd().endsWith('{')) {
      const closeBrace = after.indexOf('}');
      selection = closeBrace !== -1 && after.slice(0, closeBrace).replace(/\s/g, '').length > 0;
    } else {
      selection = !after.startsWith(')');
    }
    out.push({
      file,
      verb,
      line: line + code.slice(0, m.index).split('\n').length - 1,
      unprojected: !selection,
    });
  }
  return out;
}

export function readFindings(sites: ReadSite[]): Finding[] {
  return sites.filter((s) => s.unprojected).map((s) => ({
    file: s.file,
    line: s.line,
    verb: s.verb,
    detail: 'a public route reads with an unprojected .select() — this is SELECT *, so the row '
      + 'in scope is whatever the table holds, now and after any later migration. Name the columns '
      + '(or select a shared projection). "But I only use it for a status check" is not an exemption: '
      + 'see #2443, where the detail handler read the whole ticket to send the customer '
      + 'metadata.resolution plus the staff uuids.',
  }));
}

export function findings(sites: WriteSite[]): Finding[] {
  return sites.filter((s) => s.unprojected).map((s) => ({
    file: s.file,
    line: s.line,
    verb: s.verb,
    detail: 'a public route returns an unprojected .returning() — this is RETURNING *, so the '
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

/**
 * Blank every exported handler's own text, keeping the line count, so the rest
 * of the module can be audited separately.
 *
 * Module-level code is not outside the rule. `ticketWithReplies` in
 * `app/api/public/tickets/[id]/route.ts` is what assembles the customer's
 * response (#2443), and a whole-row read written one function below the handler
 * that returns it leaks exactly as much as one written inline — it only hides
 * from a scan that slices the file into handler bodies. Attributing those sites
 * to `module` is what makes "the guard walks the file" mean "the guard walks
 * the file".
 */
export function maskHandlerBodies(source: string, handlers: { line: number; body: string }[]): string {
  const lines = source.split('\n');
  for (const h of handlers) {
    const start = h.line - 1;
    const span = h.body.split('\n').length;
    for (let i = start; i < Math.min(lines.length, start + span); i++) lines[i] = '';
  }
  return lines.join('\n');
}

export type RunResult = { files: number; writes: number; reads: number; problems: Finding[] };

export function run(root = '.', opts: { sites?: WriteSite[]; readSites?: ReadSite[]; dirs?: string[] } = {}): RunResult {
  let sites = opts.sites;
  let reads = opts.readSites;
  if (!sites && !reads) {
    sites = [];
    reads = [];
    let files = 0;
    for (const rel of opts.dirs ?? [join('app', 'api', 'public')]) {
      const dir = isAbsolute(rel) ? rel : join(root, rel);
      for (const file of walkRouteFiles(dir)) {
        files++;
        const abs = readFileSync(file, 'utf8');
        const relFile = relative(root, file).split('\\').join('/');
        const handlers = enumerateHandlers(abs, relFile);
        for (const h of handlers) {
          sites.push(...findWriteSites(h.body, h.file, h.verb, h.line));
          reads.push(...findReadSites(h.body, h.file, h.verb, h.line));
        }
        const rest = maskHandlerBodies(abs, handlers);
        sites.push(...findWriteSites(rest, relFile, 'module', 1));
        reads.push(...findReadSites(rest, relFile, 'module', 1));
      }
    }
    if (!opts.dirs && files === 0) throw new Error('no route.ts found under app/api/public — nothing audited');
    if (sites.length < MIN_PUBLIC_WRITE_SITES) {
      throw new Error(
        `found only ${sites.length} public write site(s); expected at least ${MIN_PUBLIC_WRITE_SITES} — `
        + 'the insert chain was not matched, so this run proves nothing',
      );
    }
    if (reads.length < MIN_PUBLIC_READ_SITES) {
      throw new Error(
        `found only ${reads.length} public read site(s); expected at least ${MIN_PUBLIC_READ_SITES} — `
        + 'no .select() was matched, so this run proves nothing about the read side',
      );
    }
  }
  // A planted write-only or read-only run is a legitimate run: the kind that
  // was not supplied reports zero rather than silently walking the disk for it.
  sites = sites ?? [];
  reads = reads ?? [];
  const all = [...sites, ...reads];
  return {
    files: new Set(all.map((s) => s.file)).size,
    writes: sites.length,
    reads: reads.length,
    problems: [...findings(sites), ...readFindings(reads)],
  };
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
      `[check-public-row-projection] OK — ${result.writes} public write site(s) and `
      + `${result.reads} read site(s) across ${result.files} route file(s), every one naming the `
      + `columns it moves.\n`,
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
