import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2822 — Restore History has been asking for `/api/superadmin/selective-restore/logs`
 * since #1328 wired it to TanStack Query, and nothing ever answered it. Not a
 * regression: `git log --diff-filter=D -- app/api/superadmin/selective-restore/logs` is
 * empty, so the handler was never written. Next's 404 became a query error no one
 * read, `logs ?? []` became an empty array, and the panel told every operator on
 * every install that no restore had ever run.
 *
 * Nothing in CI could notice, because a missing route file is not an error — it is
 * the absence of one. `check-route-boundaries` reads the handler side (auth, tenancy)
 * of routes that exist, and the panels' own fetches were never pointed back at the
 * tree. So this screen reads the client side: every literal `/api/...` URL under
 * `app/**` must have something behind it — a `route.ts`, or a static file under
 * `public/`.
 *
 * What it cannot see, and does not claim to: URLs assembled at runtime — a template
 * literal that interpolates has a dynamic tail this file would have to guess at, so it
 * is left alone rather than half-matched. It covers the static half of the surface,
 * which is where #2822 lives.
 */

/** URL → the issue carrying the missing handler. May only SHRINK, entry by entry. */
const ALLOWLIST: Record<string, string> = {
  '/api/superadmin/token-control/report/top-spenders':
    '#2880: the spenders table has been GETting a handler that was never written, same shape as #2822',
  '/api/tenant/rbac/approval-rules':
    '#2597: the Approval Rules tab renders a list against an endpoint that does not exist',
};

const pageSources = (dir = 'app', out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // the handlers themselves are the other half of the pair, not a caller
      if (p === 'app/api') continue;
      pageSources(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
};

/**
 * A string literal whose content starts as an `/api/...` path. `?`, `&`, `#` and
 * the rest are allowed in and stripped afterwards — `'/api/x?id=7'` is a call to
 * `/api/x`, and the control below proves it is not skipped. `$`, `{`, `}` are not:
 * a backtick URL that interpolates has a dynamic tail this file would have to
 * guess at, so the whole literal is left alone rather than half-matched.
 */
const STATIC_API_URL = /(['"`])(\/api\/[^'"`\s${}]*)\1/g;

export function urlsIn(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(STATIC_API_URL)) {
    const url = m[2]!.split('?')[0]!.split('#')[0]!;
    // `/api/` alone is the prefix half of a `'/api/' + id` build, not a URL
    if (url === '/api/' || url.endsWith('/')) continue;
    found.push(url);
  }
  return [...new Set(found)];
}

/**
 * Is there anything under `app/api` — or a static file under `public/` — that would
 * answer this URL?
 *
 * Two shapes need resolving before the question means anything. `app/tenant/docs/page.tsx`
 * writes its endpoint tables with `:id` because that is how OpenAPI documents a path
 * parameter, while the tree spells the same thing `[id]`; matching the strings literally
 * would convict seven documented-and-real endpoints. And `/api/openapi.yaml` is served as
 * `public/api/openapi.yaml`, which is a correct answer to a GET even though no `route.ts`
 * exists for it.
 */
function handlerExists(url: string): boolean {
  // the URL's own `api` segment is the tree's: `/api/x` is answered by `app/api/x/route.ts`
  let dirs = ['app'];
  for (const segment of url.split('/').filter(Boolean)) {
    dirs = segment.startsWith(':')
      ? dirs.flatMap((dir) =>
          readdirSync(dir).filter((name) => /^\[.+\]$/.test(name)).map((name) => join(dir, name)))
      : dirs
          .map((dir) => join(dir, segment))
          .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
  }
  return dirs.some((dir) => existsSync(join(dir, 'route.ts'))) || existsSync(join('public', url));
}

export function dangling(file: string, source: string): string[] {
  return urlsIn(source).filter((url) => !handlerExists(url));
}

const scan = (): Array<{ file: string; url: string }> =>
  pageSources().flatMap((file) =>
    dangling(file, readFileSync(file, 'utf8')).map((url) => ({ file, url })),
  );

describe('every page URL has a handler to answer it (#2822)', () => {
  it('catches a URL with no route file (control)', () => {
    const src = `const q = useApiQuery(KEY, '/api/tenant/ghosts');\nawait fetch('/api/tenant/things?id=7');`;
    expect(urlsIn(src)).toEqual(['/api/tenant/ghosts', '/api/tenant/things']);
    expect(dangling('<inline>', src)).toEqual(['/api/tenant/ghosts', '/api/tenant/things']);
  });

  it('accepts a URL that a real handler answers (control)', () => {
    expect(dangling('<inline>', `fetch('/api/superadmin/selective-restore/logs');`)).toEqual([]);
    expect(existsSync(join('app', 'api', 'superadmin', 'selective-restore', 'logs', 'route.ts'))).toBe(true);
  });

  it('reads a documented `:id` as the `[id]` directory it names, not as a missing route (control)', () => {
    // app/tenant/docs/page.tsx documents seven endpoints this way; convicting them all
    // would teach everyone to ignore the screen
    expect(dangling('<inline>', `path: '/api/tenant/contacts/:id'`)).toEqual([]);
    expect(dangling('<inline>', `path: '/api/tenant/tickets/:id/replies'`)).toEqual([]);
    expect(existsSync(join('app', 'api', 'tenant', 'contacts', '[id]', 'route.ts'))).toBe(true);
    // and the escape hatch cannot become a blind spot: a placeholder over nothing is still dangling
    expect(dangling('<inline>', `path: '/api/tenant/ghosts/:id'`)).toEqual(['/api/tenant/ghosts/:id']);
  });

  it('accepts a URL that public/ serves as a file (control)', () => {
    expect(dangling('<inline>', `href="/api/openapi.yaml"`)).toEqual([]);
    expect(existsSync(join('public', 'api', 'openapi.yaml'))).toBe(true);
  });

  it('leaves a URL that is assembled at runtime alone (control)', () => {
    // the tail is a variable, so there is nothing static here to check against
    expect(urlsIn('fetch(`/api/tenant/contacts/${id}`)')).toEqual([]);
  });

  it('is not looking at nothing', () => {
    const callers = pageSources();
    const urls = callers.flatMap((f) => urlsIn(readFileSync(f, 'utf8')));
    expect(callers.length, 'no page sources found — the walk is broken').toBeGreaterThan(100);
    expect(urls.length, 'no static /api URLs found — the pattern is broken').toBeGreaterThan(150);
  });

  it('every dangling URL is on the allowlist, and the allowlist still dangles', () => {
    const offenders = scan();
    expect(
      [...new Set(offenders.map((o) => o.url))].sort(),
      Object.keys(ALLOWLIST).length === 0
        ? 'a page calls an /api URL with nothing behind it'
        : 'a page calls an /api URL with nothing behind it — fix it, or name the issue that carries it',
    ).toEqual(Object.keys(ALLOWLIST).sort());

    // shrink-only in both directions: an entry whose handler got written must be
    // deleted, or the screen quietly stops covering the class it was written for
    for (const url of Object.keys(ALLOWLIST)) {
      expect(handlerExists(url), `${url} now has a handler — drop the entry`).toBe(false);
    }
  });

  it('names the file that calls each allowlisted URL, so the entry is findable', () => {
    const byUrl = new Map<string, string[]>();
    for (const o of scan()) byUrl.set(o.url, [...(byUrl.get(o.url) ?? []), o.file]);
    for (const url of Object.keys(ALLOWLIST)) {
      expect(byUrl.get(url)?.length, `${url} is allowlisted but no page calls it`).toBeGreaterThan(0);
      expect(ALLOWLIST[url]).toMatch(/^#\d{4}:/);
    }
  });
});
