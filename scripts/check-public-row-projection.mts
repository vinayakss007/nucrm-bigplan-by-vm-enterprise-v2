/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public-write row-projection guard (#2440) + public-read row-projection guard
 * (#2443) + public relational-query read guard (#2457), over the whole anonymous
 * surface (#2459).
 *
 * Every exported handler on that surface — every route `proxy.ts` lets through
 * without a session, not just the ones under a folder called `public` — must name
 * the columns it moves, in whichever of the three spellings drizzle offers:
 * `.returning({...})` never `.returning()`, `.select({...})` (or a shared named
 * projection) never `.select()`, and `db.query.<table>.findFirst({ columns: {...} })`
 * never `db.query.<table>.findFirst({ where })`.
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
 * Scope, deliberately (derived from the edge, not from a path guess — #2459):
 *  - The first pass checked `app/api/public/**` because that was where the leak
 *    was. The rule is about the caller, not the folder: the anonymous surface is
 *    every route `proxy.ts` lets through without a session. So the directories
 *    come from `PUBLIC_PATHS` and `PUBLIC_PREFIXES` — each `/api/...` entry
 *    resolves to `app/<path>` and is walked as a tree, because `isPublic()`
 *    matches those entries as a prefix as well as exactly (proxy.ts:276).
 *    Naming directories by hand was the wrong unit: the coarse ones both missed
 *    public routes (`/api/tenant/portal/login`) and dragged in staff routes that
 *    happen to share a parent (`/api/tenant/portal/clients`).
 *  - Staff routes echo whole rows to authenticated agents and that is a different
 *    trust decision.
 *  - Reads are in scope as of #2443, and the rule for them is stricter than the
 *    issue asked for. #2443 AC6 offered a guard that tells apart "row returned
 *    to the client" from "row read for server-side logic", because the two
 *    public quote handlers (`accept`, `decline`) read the whole quote only to
 *    test `status`/`expiresAt` and answer `{ ok, status, accepted_at }` — the row
 *    never went out. Making that call is a dataflow guess, and a guard that
 *    guesses has to be re-guessed by the next editor: classify one read as
 *    harmless, then someone adds `return NextResponse.json({ data: quote })`
 *    fifteen lines below it and the tree is leaky while the guard prints OK. So
 *    there is no classifier. Every `.select()` on the anonymous surface names its
 *    columns, the logic-only reads included — `accept` now names the seven
 *    fields it tests or copies, `decline` the five. That also stops them
 *    fetching a row the size of the table to decide a branch. Zero exceptions,
 *    so zero baseline to pin.
 *  - `db.query.<table>.findFirst()/findMany()` is in scope as of #2457 — the
 *    same rule, applied to the spelling the first two passes did not match. See
 *    `findRelationalReadSites` for why a third regex was needed rather than a
 *    wider read of the same one.
 *
 * The one thing a rule this blunt needs is a way to say "here I mean it", and a
 * way to check that the saying is still true:
 *  - `// row-projection-exempt: #NNNN <reason>` within the three lines above a
 *    call waives that call.
 *  - A marker that cites no issue waives nothing: the issue is the only record of
 *    why the read is wide, and without it the next editor has a comment and no
 *    way to check it.
 *  - A marker that covers nothing is a violation. Either the call below it gained
 *    its projection and the marker is now decoration over a compliant read —
 *    where it will be trusted by whoever copies the shape — or it drifted off the
 *    call it was written for. Both are reported by `staleMarkerFindings`.
 *  - Exactly one site uses it: `app/api/forms/submit`, whose contact read is the
 *    input to a tenant-authored formula engine that addresses arbitrary columns
 *    by name. Narrowing it does not throw and does not fail typecheck; the engine
 *    reads `undefined`, returns null, and the stored values quietly go stale.
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
 * clean. The floors are set on the proxy-derived scope — 48 public `/api/` paths,
 * 46 of them resolving to a route tree, 79 `route.ts` files, and #2459 measured
 * 28 `.returning()` / 65 `.select()` / 47 relational sites across them. Each floor
 * leaves about half of that as room for a legitimate refactor, and still fails a
 * walk or a regex that died quietly. They gate the default scope only; see `run`.
 */
export const MIN_PUBLIC_WRITE_SITES = 12;

/**
 * Same reasoning as the write floor: 65 `.select()` calls sit on the anonymous
 * surface, so a walk that turns up fewer than thirty is a broken regex or a
 * broken walk, not a codebase that reads no columns.
 */
export const MIN_PUBLIC_READ_SITES = 30;

/**
 * And the same for the relational query API: 47 `db.query.<table>.findFirst()` /
 * `findMany()` calls sit on the anonymous surface (the cron sweeps and the OAuth
 * endpoints are the bulk of them, which is what #2459 added to the scope), so a
 * walk that turns up fewer than twenty is a broken screen, not a codebase that
 * reads nothing through `db.query`.
 */
export const MIN_PUBLIC_RELATIONAL_READ_SITES = 20;

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

/**
 * An inline waiver. `line` is the 1-based line of the `//` itself.
 */
export type ExemptMarker = {
  file: string;
  line: number;
  /** the issue the marker cites, or null when it cites none */
  issue: string | null;
};

const MARKER_RE = /^\s*\/\/\s*row-projection-exempt\b[ \t]*:?[ \t]*(.*)$/;
const CITED_ISSUE_RE = /#\s*(\d{2,})/;

/** How far above the call a marker may sit and still cover it. */
export const EXEMPT_WINDOW = 3;

/**
 * Every waiver marker in a file.
 *
 * Read from the raw source, because a marker is prose and `stripComments` exists
 * to remove prose from the screen — but only prose that is really a marker: a
 * line comment sitting inside a block comment is this guard documenting its own
 * syntax, and minting a live waiver out of that would hand the next reader a
 * marker he cannot delete without editing the explanation.
 */
export function findExemptMarkers(source: string, file: string): ExemptMarker[] {
  const out: ExemptMarker[] = [];
  const lines = source.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCommentLine = /^\s*\/\//.test(line);
    if (!inBlock && isCommentLine) {
      const m = MARKER_RE.exec(line);
      if (m) {
        const issue = CITED_ISSUE_RE.exec(m[1]);
        out.push({ file, line: i + 1, issue: issue ? issue[1] : null });
      }
      // A line comment opens and closes nothing.
      continue;
    }
    // Track the block comments only well enough to tell a marker from prose that
    // quotes one. A brace inside a string literal can make this stick — and the
    // direction it sticks in is the safe one: a lost waiver shows up as a
    // violation on a read someone already documented, never as a false OK.
    for (let j = 0; j < line.length - 1; j++) {
      const pair = line.slice(j, j + 2);
      if (inBlock) {
        if (pair === '*/') { inBlock = false; j++; }
        continue;
      }
      if (pair === '/*') { inBlock = true; j++; }
    }
  }
  return out;
}

export type ExemptionResult = { waived: Finding[]; problems: Finding[] };

/**
 * Split the unprojected findings into "waived by a marker that cites an issue"
 * and "still a violation", and report the markers that have no business being
 * there.
 *
 * The three failure modes are the ones that make an inline exemption rot instead
 * of working: a marker that cites nothing cannot be checked, a marker that drifted
 * off its call still reads as permission to whoever finds it, and a marker above a
 * call that already names its columns teaches the next editor that the marker is
 * decoration.
 */
export function applyExemptions(unprojected: Finding[], markers: ExemptMarker[]): ExemptionResult {
  const waived: Finding[] = [];
  const problems: Finding[] = [];
  const attached = new Set<number>();
  const byFile = new Map<string, ExemptMarker[]>();
  for (const mk of markers) {
    const list = byFile.get(mk.file);
    if (list) list.push(mk);
    else byFile.set(mk.file, [mk]);
  }
  for (const f of unprojected) {
    const covering = (byFile.get(f.file) ?? [])
      .filter((mk) => mk.line <= f.line && f.line - mk.line <= EXEMPT_WINDOW)
      .sort((a, b) => b.line - a.line)[0];
    if (!covering) { problems.push(f); continue; }
    attached.add(markers.indexOf(covering));
    if (covering.issue) waived.push({ ...f, detail: `${f.detail} (waived by #${covering.issue} at line ${covering.line})` });
    else {
      problems.push({
        ...f,
        detail: 'the row-projection-exempt marker at line ' + covering.line + ' cites no issue, so it '
          + 'waives nothing — the issue is the only record of why this read is wide, and without it the '
          + 'next editor has a comment and no way to check it. Write `// row-projection-exempt: #NNNN <reason>`.',
      });
    }
  }
  problems.push(...staleMarkerFindings(markers, attached));
  return { waived, problems };
}

/**
 * Markers that attached to no unprojected call. `attached` holds the indices, into
 * the same `markers` array, that the waiver pass claimed.
 */
export function staleMarkerFindings(markers: ExemptMarker[], attached: Set<number>): Finding[] {
  const out: Finding[] = [];
  markers.forEach((mk, i) => {
    if (attached.has(i)) return;
    out.push({
      file: mk.file,
      line: mk.line,
      verb: 'marker',
      detail: mk.issue
        ? `a row-projection-exempt marker covering nothing — within ${EXEMPT_WINDOW} lines below it `
          + 'there is no unprojected read (either the call gained its projection, in which case the '
          + 'marker is now decoration over a compliant read and will be copied as one, or it drifted off '
          + 'the call it was written for). Delete it.'
        : `a row-projection-exempt marker that cites no issue and covers nothing within ${EXEMPT_WINDOW} `
          + 'lines below it. Delete it, or point it at the unprojected read it means.',
    });
  });
  return out;
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

export type RelationalReadSite = {
  file: string;
  verb: string;
  line: number;
  table: string;
  method: 'findFirst' | 'findMany';
  /** true when the call cannot be shown to name a column set */
  unprojected: boolean;
};

const RELATIONAL_RE = /\.query\s*\.\s*([a-zA-Z_$][\w$]*)\s*\.\s*(findFirst|findMany)\s*\(\s*/g;

/**
 * The options object of a `db.query.<table>.findFirst(...)` call, without its
 * braces, or null when the argument is not an object literal the screen can read.
 */
export function relationalOptions(text: string): string | null {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') {
      const close = text.indexOf(c, j + 1);
      if (close === -1) return null;
      j = close;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(i + 1, j);
    }
  }
  return null;
}

/**
 * A `columns:` key at the top level of the options object. Not anywhere inside
 * it: `with: { tickets: { columns: {...} } }` narrows the *nested* rows and
 * leaves the outer row wide, which is the mistake this shape invites.
 */
export function hasTopLevelColumns(options: string): boolean {
  let depth = 0;
  for (let i = 0; i < options.length; i++) {
    const c = options[i];
    if (c === '"' || c === "'" || c === '`') {
      // A value may be a string containing braces; it is not structure.
      const close = options.indexOf(c, i + 1);
      i = close === -1 ? options.length : close;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth !== 0 || !/[A-Za-z_$]/.test(c)) continue;
    let end = i;
    while (end < options.length && /[\w$]/.test(options[end])) end++;
    let colon = end;
    while (colon < options.length && /\s/.test(options[colon])) colon++;
    if (options[colon] === ':') {
      if (options.slice(i, end) === 'columns') return true;
      i = colon;
    } else {
      i = end - 1;
    }
  }
  return false;
}

/**
 * `db.query.<table>.findFirst()` is a read too, and by default it is `SELECT *`
 * of the whole table shape.
 *
 * #2440 and #2443 made a public handler name the columns it moves, and screened
 * the two spellings that token contains — `.select(...)` and `.returning(...)`.
 * Drizzle's relational query API is a third spelling that neither regex matches:
 * `db.query.contacts.findFirst({ where })` fetches every column of the table
 * (55 for `contacts`, measured on the live database) unless the call names
 * `columns: {...}`. So the tree could satisfy the guard while nine
 * anonymous-reachable whole-row reads sat inside the very files the guard walks,
 * and the screen would still print "every one naming the columns it moves".
 *
 * Same rule as the reads above, and for the same reason: no classifier for "used
 * only for a status check", because that judgement is a guess the next editor
 * does not have to re-make.
 */
export function findRelationalReadSites(
  body: string,
  file: string,
  verb: string,
  line: number,
): RelationalReadSite[] {
  const code = stripComments(body);
  const out: RelationalReadSite[] = [];
  const re = new RegExp(RELATIONAL_RE.source, 'g');
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const after = code.slice(m.index + m[0].length);
    const options = relationalOptions(after);
    const projected = options !== null && hasTopLevelColumns(options);
    out.push({
      file,
      verb,
      line: line + code.slice(0, m.index).split('\n').length - 1,
      table: m[1],
      method: m[2] as 'findFirst' | 'findMany',
      unprojected: !projected,
    });
  }
  return out;
}

export function relationalFindings(sites: RelationalReadSite[]): Finding[] {
  return sites.filter((s) => s.unprojected).map((s) => ({
    file: s.file,
    line: s.line,
    verb: s.verb,
    detail: `a public route reads db.query.${s.table}.${s.method}() without a top-level `
      + '`columns:` projection — that is SELECT * of the whole row, so the row in scope is '
      + 'whatever the table holds, now and after any later migration. Name the columns '
      + '(`columns: { id: true, tenantId: true }`), exactly as .select() and .returning() '
      + 'must name theirs. A `columns:` nested inside `with:` narrows the related rows only, '
      + 'not this one.',
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

/**
 * The `/api/...` entries of `proxy.ts`'s two public lists — the anonymous surface
 * read from the file that decides it, instead of a guess about which folders look
 * public. Comments are stripped first so a path quoted in prose cannot widen the
 * scope.
 */
export function publicApiPaths(proxySource: string): string[] {
  const code = stripComments(proxySource);
  const out = new Set<string>();
  const arrays = /const PUBLIC_(?:PATHS|PREFIXES)\s*=\s*\[([\s\S]*?)\];/g;
  for (let m = arrays.exec(code); m !== null; m = arrays.exec(code)) {
    for (const q of m[1].matchAll(/'([^']*)'/g)) {
      if (q[1].startsWith('/api/')) out.add(q[1]);
    }
  }
  return [...out].sort();
}

/** `app/<path>` — the directory an edge path is served from. */
export function routeDirFor(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0] !== 'api') throw new Error(`${path} is not an /api/ path`);
  return join('app', ...segments);
}

export type Scope = { dirs: string[]; unresolved: string[] };

/**
 * Split the public paths into the ones with a route tree under them and the ones
 * the edge advertises and nothing serves.
 *
 * The second group is reported, not failed. A path with no route cannot return a
 * row, so it is not this guard's violation; it is the #2415 class — a `PUBLIC_PATHS`
 * entry that says the edge is open on a door that is not there — and printing it
 * here is how it stops being invisible either way.
 */
export function resolveScope(root: string, paths: string[]): Scope {
  const dirs: string[] = [];
  const unresolved: string[] = [];
  for (const p of paths) {
    const rel = routeDirFor(p);
    if (existsSync(join(root, rel))) dirs.push(rel);
    else unresolved.push(p);
  }
  return { dirs, unresolved };
}

export type RunResult = {
  files: number;
  writes: number;
  reads: number;
  relational: number;
  /** unprojected calls excused by a marker that cites an issue */
  waived: Finding[];
  /** public `/api/` paths with no route tree behind them */
  unresolved: string[];
  problems: Finding[];
};

export function run(
  root = '.',
  opts: {
    sites?: WriteSite[];
    readSites?: ReadSite[];
    relationalSites?: RelationalReadSite[];
    markers?: ExemptMarker[];
    dirs?: string[];
  } = {},
): RunResult {
  let sites = opts.sites;
  let reads = opts.readSites;
  let rel = opts.relationalSites;
  let markers = opts.markers;
  let unresolved: string[] = [];
  if (!sites && !reads && !rel) {
    sites = [];
    reads = [];
    rel = [];
    // A planted marker list and a disk walk are not mutually exclusive: the
    // caller may be testing a waiver against a real file. Copy rather than
    // overwrite, and do not mutate the caller's array.
    markers = opts.markers ? [...opts.markers] : [];
    let scope: Scope;
    if (opts.dirs) {
      scope = { dirs: opts.dirs, unresolved: [] };
    } else {
      const proxyFile = join(root, 'proxy.ts');
      if (!existsSync(proxyFile)) {
        throw new Error('proxy.ts is missing — the anonymous surface cannot be derived');
      }
      const paths = publicApiPaths(readFileSync(proxyFile, 'utf8'));
      if (paths.length === 0) {
        throw new Error(
          'no /api/ entry was matched in PUBLIC_PATHS / PUBLIC_PREFIXES — the edge lists were '
          + 'not parsed, so this run proves nothing',
        );
      }
      scope = resolveScope(root, paths);
      if (scope.dirs.length === 0) {
        throw new Error(`none of the ${paths.length} public /api/ paths resolves to app/<path> — nothing audited`);
      }
    }
    let files = 0;
    const walked = new Set<string>();
    for (const relDir of scope.dirs) {
      const dir = isAbsolute(relDir) ? relDir : join(root, relDir);
      for (const file of walkRouteFiles(dir)) {
        // Two edge entries can share a tree (`/api/x` as a prefix and a deeper
        // path under it): walking it twice would count every site twice.
        if (walked.has(file)) continue;
        walked.add(file);
        const abs = readFileSync(file, 'utf8');
        const relFile = relative(root, file).split('\\').join('/');
        files++;
        const handlers = enumerateHandlers(abs, relFile);
        for (const h of handlers) {
          sites.push(...findWriteSites(h.body, h.file, h.verb, h.line));
          reads.push(...findReadSites(h.body, h.file, h.verb, h.line));
          rel.push(...findRelationalReadSites(h.body, h.file, h.verb, h.line));
        }
        const rest = maskHandlerBodies(abs, handlers);
        sites.push(...findWriteSites(rest, relFile, 'module', 1));
        reads.push(...findReadSites(rest, relFile, 'module', 1));
        rel.push(...findRelationalReadSites(rest, relFile, 'module', 1));
        markers.push(...findExemptMarkers(abs, relFile));
      }
    }
    unresolved = scope.unresolved;
    if (files === 0) {
      throw new Error(opts.dirs
        ? `no route.ts found under ${opts.dirs.join(', ')} — nothing audited`
        : 'no route.ts found under the public /api/ paths derived from proxy.ts — nothing audited');
    }
    // The floors are calibrated for the default, proxy-derived scope. An auditor
    // pointing the guard at a subtree is asking a narrower question, and "that
    // subtree holds 9 relational reads" is the answer rather than a broken walk —
    // the gate there is `files === 0`, and the counts get printed.
    if (!opts.dirs) {
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
      if (rel.length < MIN_PUBLIC_RELATIONAL_READ_SITES) {
        throw new Error(
          `found only ${rel.length} public relational read site(s); expected at least `
          + `${MIN_PUBLIC_RELATIONAL_READ_SITES} — no db.query.<table>.findFirst() was matched, `
          + 'so this run proves nothing about the relational query API',
        );
      }
    }
  }
  // A planted write-only or read-only run is a legitimate run: the kind that
  // was not supplied reports zero rather than silently walking the disk for it.
  sites = sites ?? [];
  reads = reads ?? [];
  rel = rel ?? [];
  const all = [...sites, ...reads, ...rel];
  const exemptions = applyExemptions(
    [...findings(sites), ...readFindings(reads), ...relationalFindings(rel)],
    markers ?? [],
  );
  return {
    files: new Set(all.map((s) => s.file)).size,
    writes: sites.length,
    reads: reads.length,
    relational: rel.length,
    waived: exemptions.waived,
    unresolved,
    problems: exemptions.problems,
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
      `[check-public-row-projection] OK — ${result.writes} public write site(s), `
      + `${result.reads} .select() read site(s) and ${result.relational} relational read site(s) `
      + `across ${result.files} route file(s) named by proxy.ts, every one naming the columns `
      + `it moves${result.waived.length ? ` except ${result.waived.length} waived by an inline marker` : ''}.\n`,
    );
    for (const w of result.waived) {
      const cite = /waived by #(\d+)/.exec(w.detail);
      process.stdout.write(
        `[check-public-row-projection] waived — ${w.file}:${w.line} ${w.verb} `
        + `(cited by ${cite ? '#' + cite[1] : 'a marker'})\n`,
      );
    }
    for (const p of result.unresolved) {
      process.stdout.write(
        `[check-public-row-projection] NOTE — ${p} is in proxy.ts's public list and there is no `
        + `app/${p.replace(/^\//, '')} behind it: the edge is open on a route that does not exist (#2415 class).\n`,
      );
    }
  } else {
    process.stdout.write(`[check-public-row-projection] ${result.problems.length} violation(s):\n`);
    for (const f of result.problems) {
      process.stdout.write(`  ${f.file}:${f.line} ${f.verb} — ${f.detail}\n`);
    }
  }
  // `process.exitCode`, never `process.exit()`: stdout on a pipe is written
  // asynchronously and exit discards whatever has not drained. A `--json`
  // consumer then gets a truncated document — measured on this repo, 65,536
  // bytes of a 195,246-byte audit of `app/api`, delivered with exit status 1
  // and a perfectly parseable prefix. That is a silently under-reported audit,
  // which is the failure mode this guard family exists to avoid.
  process.exitCode = result.problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].includes('check-public-row-projection')) {
  main().catch((err: unknown) => {
    process.stderr.write(`[check-public-row-projection] ${(err as Error).message}\n`);
    process.exitCode = 2;
  });
}
