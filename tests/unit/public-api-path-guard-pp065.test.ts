/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractPublicPaths,
  filterApiPaths,
  ParseFailure,
  resolveEntry,
  routeFileToUrl,
  run,
  walkRouteFiles,
  API_ROUTE_ROOT,
  MIN_PUBLIC_API_PATHS,
  MIN_ROUTE_FILES,
  ROOT,
} from '../../scripts/check-public-api-paths.mts';

// PP-065: `proxy.ts` published two public API paths that had no route behind them
// in any commit of this repository, and a visitor posting the public lead form was
// answered 404 by the edge that had just promised them a handler. #2505 deleted
// both entries. This guard is what keeps that from being found by a visitor again.
//
// Like the other guards here it fails *open* if its parser quietly breaks: an empty
// PUBLIC_PATHS list resolves every question as "yes, that path is fine". So every
// case below is either a planted shape that must be named, a legitimate shape that
// must not be, or a proof that the parser refuses to guess.

const PROXY_SOURCE = readFileSync(join(ROOT, 'proxy.ts'), 'utf8');

/** A PUBLIC_PATHS array in the file's real shape: comments with apostrophes inside. */
const FIXTURE_PROXY = `
const SESSION_COOKIE = 'nucrm_session';
export const PUBLIC_PATHS = [
  '/', '/login',
  // The tracking pixel must answer before reaching the visitor's session handler's
  // cookie, or the open is lost (see #1982 — don't "fix" this by removing the guard).
  '/api/track/open', '/api/lead-capture',
  '/api/leads/public',
];
const API_KEY_ALLOWED_PREFIXES = ['/api/v1/', '/api/v2/'];
`;

const FIXTURE_ROUTES = [
  '/api/track/open',
  '/api/leads/public',
  // Both shapes main actually has for this entry: a same-depth [id] handler, and a
  // deeper webhook/[id]. Same-depth wins, which is what the real tree reports.
  '/api/tenant/plugins/[id]',
  '/api/tenant/plugins/webhook/[id]',
  '/api/cron/a',
  '/api/cron/b',
];

describe('extractPublicPaths — reads the array, not a line range', () => {
  it('takes only the PUBLIC_PATHS literal, in order', () => {
    expect(extractPublicPaths(FIXTURE_PROXY, 'fixture')).toEqual([
      '/',
      '/login',
      '/api/track/open',
      '/api/lead-capture',
      '/api/leads/public',
    ]);
  });

  it('does not let a comment apostrophe pair with the next entry', () => {
    // The regex this replaced matched /'[^']*'/ over the raw span, so the apostrophe
    // in "handler's" opened a literal that ran to the next quote and swallowed the
    // text between them: the phantom path vanished and garbage took its place.
    const parsed = extractPublicPaths(FIXTURE_PROXY, 'fixture');
    expect(parsed).not.toContain(expect.stringContaining('cookie'));
    expect(parsed.every((p) => p.startsWith('/'))).toBe(true);
    expect(parsed).toContain('/api/lead-capture');
  });

  it('stops at the closing bracket and ignores the arrays after it', () => {
    const parsed = extractPublicPaths(FIXTURE_PROXY, 'fixture');
    expect(parsed).not.toContain('/api/v1/');
    expect(parsed).not.toContain('/api/v2/');
  });

  it('refuses to guess, rather than returning an empty list', () => {
    expect(() => extractPublicPaths('export const x = 1;', 'f')).toThrow(ParseFailure);
    expect(() => extractPublicPaths('const PUBLIC_PATHS = ["/a", \'/b\'];', 'f')).toThrow(/double-quoted/);
    expect(() => extractPublicPaths("const PUBLIC_PATHS = ['/a', `b`];", 'f')).toThrow(/backtick/);
    expect(() => extractPublicPaths("const PUBLIC_PATHS = ['/a'", 'f')).toThrow(/never closed/);
    expect(() => extractPublicPaths("const PUBLIC_PATHS = ['/a\n'];", 'f')).toThrow(/unterminated/);
    expect(() => extractPublicPaths('const PUBLIC_PATHS = [];', 'f')).toThrow(/zero entries/);
  });
});

describe('resolveEntry — three yeses and one no', () => {
  it('names an entry with no route at, under, or matching it (the PP-065 shape)', () => {
    expect(resolveEntry('/api/lead-capture', FIXTURE_ROUTES)).toEqual({ kind: 'unresolved' });
    expect(unresolvedOf(['/api/lead-capture', '/api/track/open'], FIXTURE_ROUTES)).toEqual([
      '/api/lead-capture',
    ]);
  });

  it('accepts an exact route', () => {
    expect(resolveEntry('/api/track/open', FIXTURE_ROUTES).kind).toBe('exact');
  });

  it('accepts a dynamic segment answering the literal (measured on main)', () => {
    // /api/tenant/plugins/webhook is listed; only …/webhook/[id] exists. That IS
    // served, and a guard that called it a phantom would be wrong on the record.
    expect(resolveEntry('/api/tenant/plugins/webhook', FIXTURE_ROUTES).kind).toBe('dynamic');
  });

  it('accepts a namespace entry whose children exist (measured on main)', () => {
    const res = resolveEntry('/api/cron', FIXTURE_ROUTES);
    expect(res.kind).toBe('prefix');
    if (res.kind === 'prefix') expect(res.children).toBe(2);
  });

  it('accepts a namespace entry with children, and rejects a lookalike name', () => {
    // /api/track has no route of its own but /api/track/open does, so the entry is
    // a live namespace. /api/trac matches nothing at any depth: prefix is not
    // fuzzy matching, and a typo in the list must not resolve.
    expect(resolveEntry('/api/track', FIXTURE_ROUTES).kind).toBe('prefix');
    expect(resolveEntry('/api/trac', FIXTURE_ROUTES).kind).toBe('unresolved');
  });
});

function unresolvedOf(paths: string[], routes: string[]): string[] {
  return paths.filter((p) => resolveEntry(p, routes).kind === 'unresolved');
}

describe('routeFileToUrl', () => {
  it('maps a route file to the URL it serves', () => {
    expect(routeFileToUrl(join('app', 'api', 'leads', 'public', 'route.ts'))).toBe('/api/leads/public');
    expect(routeFileToUrl('app/api/public/tickets/route.ts')).toBe('/api/public/tickets');
    expect(routeFileToUrl('app/api/route.ts')).toBe('/api');
  });
  it('ignores anything that is not an app route file', () => {
    expect(routeFileToUrl('app/(marketing)/page.tsx')).toBeNull();
    expect(routeFileToUrl('lib/api/leads/route.ts')).toBeNull();
  });
});

describe('the real tree (this is what CI is actually checking)', () => {
  const result = run();

  it('has no public /api entry without a route behind it', () => {
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.unresolved).toEqual([]);
  });

  it('found the list it claims to have found', () => {
    // Both floors exist so that "found nothing" can never read as "all clear".
    expect(result.publicApiPaths).toBeGreaterThanOrEqual(MIN_PUBLIC_API_PATHS);
    expect(result.routeFiles).toBeGreaterThanOrEqual(MIN_ROUTE_FILES);
    expect(filterApiPaths(extractPublicPaths(PROXY_SOURCE)).length).toBe(result.publicApiPaths);
  });

  it('still resolves every entry the deleted phantoms were confused with', () => {
    // #2505 removed /api/lead-capture and /api/lead-capture/submit. If either ever
    // comes back without a route file, this is the assertion that says so.
    const api = filterApiPaths(extractPublicPaths(PROXY_SOURCE));
    expect(api).not.toContain('/api/lead-capture');
    expect(api).not.toContain('/api/lead-capture/submit');
  });

  it('classifies the entries a naive guard would wrongly call phantoms', () => {
    // Both of these were reported dead by a first-pass version of this audit and
    // are, on the tree, served: one by a dynamic segment at the entry's own depth,
    // one as a namespace whose children answer. Getting these wrong is how a guard
    // teaches people to delete the guard.
    const routes = walkRouteFiles(join(ROOT, API_ROUTE_ROOT)).map(routeFileToUrl).filter(
      (u): u is string => u !== null,
    );
    expect(resolveEntry('/api/tenant/plugins/webhook', routes).kind).toBe('dynamic');
    expect(resolveEntry('/api/public/offers', routes).kind).toBe('prefix');
    expect(resolveEntry('/api/cron', routes).kind).toBe('prefix');
    expect(resolveEntry('/api/leads/public', routes).kind).toBe('exact');
  });
});
