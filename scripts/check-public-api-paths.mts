/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public API path-existence guard (PP-065).
 *
 * `proxy.ts` decides, from a literal list, which requests reach the app without
 * a session. `PUBLIC_PATHS` is that list, and an entry in it is a *promise made
 * at the edge*: every visitor who asks for that path is handed to a handler
 * instead of being sent to sign in.
 *
 * PP-065 found two entries whose promise nothing could keep. `/api/lead-capture`
 * and `/api/lead-capture/submit` had been listed ever since the 2026-05 middleware
 * migration carried them over from `middleware.ts`, and no route file has existed
 * at either path in any commit of this repository's history — `git log --all
 * --diff-filter=A` across every ref returns nothing. A visitor posting the public
 * lead form from `/lead-capture` was answered with a bare **404** by the edge that
 * had just promised them a handler. #2505 (`e0b909cc`) deleted both entries.
 *
 * Nothing in the tree stops a third one from being added tomorrow, and no existing
 * check can: the projection guard (#2440/#2443/#2457/#2459) reads the handlers that
 * *do* exist and asserts what they select, so a listed path with no handler is
 * invisible to it — there is no file to open. `guard:coords` reads the register's
 * citations. The page-record sweep asserts HTTP 200 on renders. A list entry is
 * only ever executed by a visitor, which is the worst possible time to find out.
 *
 * So the rule is structural: **every `/api/…` entry in `PUBLIC_PATHS` must be
 * served by a route that exists** — at that exact path, at the same path with a
 * dynamic segment (`[id]` answers the literal), or as a prefix with children under
 * it (the way `/api/cron` and `/api/public/offers` legitimately work). A page entry
 * is not covered here: pages render, and PP-065's surviving half is a form whose
 * endpoint rejects it, which is an ownership decision (#152), not a missing file.
 *
 * The guard reports rather than infers. It parses the array by bracket depth and
 * refuses, loudly, any shape it cannot prove it read completely — a quote style it
 * did not match, a comment containing an apostrophe, an array it could not close.
 * That matters because the failure mode of a broken parser is not an error but an
 * empty list, and an empty list passes every check. The floors below are what turn
 * "found nothing" back into a red build.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ROOT = join(import.meta.dirname!, '..');
export const PROXY_FILE = 'proxy.ts';
export const API_ROUTE_ROOT = join('app', 'api');

/**
 * Measured on main at authoring time: 50 `/api/…` entries in PUBLIC_PATHS.
 * A parser that silently matched nothing would return 0, so 0 must be red.
 */
export const MIN_PUBLIC_API_PATHS = 40;

/** Measured: 508 route files under app/api. */
export const MIN_ROUTE_FILES = 300;

export class ParseFailure extends Error {}

/**
 * The `const PUBLIC_PATHS = [ … ];` literal, taken by bracket depth rather than
 * by line range — a line range is exactly the thing that drifts when someone
 * adds an entry, and PP-061 and PP-065 both spent a review discovering that.
 */
export function extractPublicPaths(source: string, fileLabel = PROXY_FILE): string[] {
  const decl = source.indexOf('const PUBLIC_PATHS');
  if (decl === -1) {
    throw new ParseFailure(`${fileLabel}: no \`const PUBLIC_PATHS\` declaration found`);
  }
  const open = source.indexOf('[', decl);
  if (open === -1) {
    throw new ParseFailure(`${fileLabel}: PUBLIC_PATHS is not followed by an array literal`);
  }

  let depth = 0;
  let i = open;
  const paths: string[] = [];

  // Scanned, not regexed. The array is interleaved with comments that contain
  // apostrophes ("before reaching the handler's contract"), and a /'[^']*'/
  // match happily pairs one of those with the opening quote of the *next*
  // entry, swallowing the text between them into a bogus literal. A guard that
  // misreads the list this way reports the real paths as missing and the
  // garbage as present, which is worse than not running.
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      i += 1;
      if (depth === 0) break;
      continue;
    }
    if (ch === '"' || ch === '`') {
      throw new ParseFailure(
        `${fileLabel}: PUBLIC_PATHS contains a ${ch === '"' ? 'double' : 'backtick'}-quoted ` +
          `literal this parser does not read — teach extractPublicPaths() rather than letting it skip entries`,
      );
    }
    if (ch === "'") {
      i += 1;
      let literal = '';
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          literal += c + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === "'") {
          i += 1;
          closed = true;
          break;
        }
        if (c === '\n') {
          throw new ParseFailure(`${fileLabel}: unterminated string literal in PUBLIC_PATHS`);
        }
        literal += c;
        i += 1;
      }
      if (!closed) throw new ParseFailure(`${fileLabel}: PUBLIC_PATHS string literal is never closed`);
      paths.push(literal);
      continue;
    }

    i += 1;
  }

  if (depth !== 0) {
    throw new ParseFailure(`${fileLabel}: PUBLIC_PATHS array is never closed`);
  }

  if (paths.length === 0) {
    throw new ParseFailure(`${fileLabel}: PUBLIC_PATHS parsed to zero entries`);
  }
  // Every entry this edge knows about must start at "/" — a stray apostrophe
  // inside a comment would otherwise become a path and dilute the count.
  const malformed = paths.filter((p) => !p.startsWith('/'));
  if (malformed.length > 0) {
    throw new ParseFailure(
      `${fileLabel}: PUBLIC_PATHS parsed ${malformed.length} entry/entries that do not start with "/": ` +
        malformed.map((p) => JSON.stringify(p)).join(', '),
    );
  }

  return paths;
}

/** The subset of the list that names an API handler rather than a page. */
export function filterApiPaths(paths: string[]): string[] {
  return paths.filter((p) => p.startsWith('/api/'));
}

/** `app/api/public/tickets/route.ts` -> `/api/public/tickets`. */
export function routeFileToUrl(file: string): string | null {
  if (!file.endsWith(`${sep}route.ts`) && !file.endsWith('/route.ts')) return null;
  const withoutSuffix = file.replace(/\/route\.ts$/, '');
  const fromApp = withoutSuffix.startsWith(`app${sep}`)
    ? withoutSuffix.slice(4)
    : withoutSuffix.startsWith('app/')
      ? withoutSuffix.slice(4)
      : null;
  if (fromApp === null) return null;
  return `/${fromApp.split(sep).join('/')}`;
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function isDynamic(segment: string): boolean {
  return /^\[.+\]$/.test(segment) || /^\[.*\.\.\..*\]$/.test(segment);
}

/** A route segment answers a literal request segment if equal, or if dynamic. */
function segmentMatches(routeSeg: string, entrySeg: string): boolean {
  return routeSeg === entrySeg || isDynamic(routeSeg);
}

export type Resolution =
  | { kind: 'exact'; servedBy: string }
  | { kind: 'dynamic'; servedBy: string }
  | { kind: 'prefix'; servedBy: string; children: number }
  | { kind: 'unresolved' };

/**
 * Is this list entry actually reachable? Three yeses and one no:
 *   exact    — a route.ts sits at precisely this path
 *   dynamic  — one sits at the same depth with a [param] where the entry is literal
 *              (main lists `/api/tenant/plugins/webhook` and `…/plugins/[id]/route.ts`
 *              answers it, with `id` bound to the literal "webhook")
 *   prefix   — the entry is a namespace whose children exist (`/api/cron`, 22 routes)
 *   unresolved — nothing at, under, or matching this path serves it, which is PP-065
 *
 * "Served" is not the same as "safe to serve": the dynamic case above resolves, and
 * the handler it resolves to calls `requireAuth` itself (`app/api/tenant/plugins/[id]/route.ts:28`)
 * and filters by `ctx.tenantId` (`:37`), so the anonymous visitor is refused by the
 * handler rather than by the edge. This guard asks only the existence question,
 * because existence is the question nobody else asks and PP-065 is the answer to it.
 */
export function resolveEntry(entry: string, routes: string[]): Resolution {
  const entrySegs = segments(entry);
  let children = 0;
  let dynamicMatch: string | null = null;

  for (const route of routes) {
    const routeSegs = segments(route);
    if (route === entry) return { kind: 'exact', servedBy: route };

    if (routeSegs.length > entrySegs.length) {
      const isAncestor = entrySegs.every((seg, idx) => segmentMatches(routeSegs[idx], seg));
      if (isAncestor) children += 1;
    } else if (routeSegs.length === entrySegs.length) {
      const matches = entrySegs.every((seg, idx) => segmentMatches(routeSegs[idx], seg));
      if (matches) dynamicMatch = route;
    }
  }

  if (dynamicMatch) return { kind: 'dynamic', servedBy: dynamicMatch };
  if (children > 0) return { kind: 'prefix', servedBy: `${entry}/*`, children };
  return { kind: 'unresolved' };
}

export function unresolvedPaths(apiPaths: string[], routes: string[]): string[] {
  return apiPaths.filter((entry) => resolveEntry(entry, routes).kind === 'unresolved');
}

export interface GuardResult {
  ok: boolean;
  problems: string[];
  publicApiPaths: number;
  routeFiles: number;
  unresolved: string[];
}

export function walkRouteFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkRouteFiles(full, acc);
    else if (name === 'route.ts') acc.push(relative(ROOT, full).split(sep).join('/'));
  }
  return acc;
}

export function run(rootDir: string = ROOT): GuardResult {
  const problems: string[] = [];
  const proxyPath = join(rootDir, PROXY_FILE);

  let entries: string[];
  try {
    entries = extractPublicPaths(readFileSync(proxyPath, 'utf8'), PROXY_FILE);
  } catch (err) {
    return {
      ok: false,
      problems: [`${PROXY_FILE}: ${(err as Error).message}`],
      publicApiPaths: 0,
      routeFiles: 0,
      unresolved: [],
    };
  }

  const apiPaths = filterApiPaths(entries);
  const routes = walkRouteFiles(join(rootDir, API_ROUTE_ROOT)).map(routeFileToUrl).filter(
    (u): u is string => u !== null,
  );

  if (apiPaths.length < MIN_PUBLIC_API_PATHS) {
    problems.push(
      `found only ${apiPaths.length} /api entries in PUBLIC_PATHS; expected at least ${MIN_PUBLIC_API_PATHS} — ` +
        `a parser that matched nothing would report every path as satisfied, so this is treated as a broken guard, ` +
        `not as a cleaned list`,
    );
  }
  if (routes.length < MIN_ROUTE_FILES) {
    problems.push(
      `walked only ${routes.length} route files under ${API_ROUTE_ROOT}; expected at least ${MIN_ROUTE_FILES} — ` +
        `an unwalked tree cannot prove any path is live`,
    );
  }

  const unresolved = problems.length > 0 ? [] : unresolvedPaths(apiPaths, routes);
  if (unresolved.length > 0) {
    problems.push(
      `${unresolved.length} /api entr${unresolved.length === 1 ? 'y is' : 'ies are'} listed in PUBLIC_PATHS ` +
        `with no route at, under, or dynamically matching that path:\n` +
        unresolved.map((p) => `    ${p}`).join('\n') +
        `\n  A visitor asking for these is handed a 404 by the edge that just promised them a handler. ` +
        `Either build the route, or delete the entry — see PP-065 for why an entry cannot be left to rot.`,
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    publicApiPaths: apiPaths.length,
    routeFiles: routes.length,
    unresolved,
  };
}

async function main(): Promise<void> {
  const result = run();
  if (result.ok) {
    console.log(
      `check-public-api-paths: OK — ${result.publicApiPaths} public /api entries, ` +
        `${result.routeFiles} route files, 0 unresolved`,
    );
    return;
  }
  console.error('check-public-api-paths: FAILED');
  for (const problem of result.problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].includes('check-public-api-paths')) {
  main().catch((err: unknown) => {
    console.error('check-public-api-paths: crashed', err);
    process.exitCode = 1;
  });
}
