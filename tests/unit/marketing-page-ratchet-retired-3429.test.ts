// @vitest-environment node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3429 — retire the landing page's entry from the #1843/#422 file-size ratchet.
 *
 * `app/(marketing)/page.tsx` measured 737 lines against a baseline entry of
 * **778**, a number #3303's merge re-pinned after #3393 grew the file past 762.
 * An entry larger than its file is not a ceiling: the guard says nothing until
 * the file has already grown 41 lines back, which is precisely the bookkeeping
 * that turned into #3400's 100-file red. The ratchet's own header states the
 * remedy — a file refactored below `MAX_LINES` has its entry deleted.
 *
 * Two kinds of assertion live here, and the distinction is the point:
 *
 *  - the ratchet half is the *ask*: no entry, ≤ 500 lines, and the shipped
 *    guard — not this file's arithmetic — is what says so;
 *  - the render half is the *constraint*: the refactor is code motion, so the
 *    page must still render every section, anchor and line of copy it rendered
 *    before. Those cases are green on both sides of the change by design; if
 *    one goes red, something was lost on the way out and not merely moved.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../../app/(marketing)/page';

const ROOT = process.cwd();
const PAGE = 'app/(marketing)/page.tsx';
const MAX_LINES = 500; // scripts/check-file-size.mjs's own ceiling

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    createElement('a', { href, className }, children),
}));
// The tour visuals are a next/dynamic ssr:false island; SSR renders them empty
// and would hide the section around them, so resolve the loader eagerly.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const Inner = { current: null as React.ComponentType<Record<string, unknown>> | null };
    void loader().then((m) => { Inner.current = m.default; });
    return function DynamicStub(props: Record<string, unknown>) {
      return Inner.current ? createElement(Inner.current, props) : null;
    };
  },
}));

function guard(args: string[]) {
  const res = spawnSync('node', ['scripts/check-file-size.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('#3429 — the landing page leaves the ratchet', () => {
  it('is no longer listed in the file-size baseline', () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/file-size-baseline.json'), 'utf8'));
    expect(Object.keys(baseline)).not.toContain(PAGE);
  });

  it('is at or under the 500-line ceiling the guard applies to an unlisted file', () => {
    const lines = readFileSync(join(ROOT, PAGE), 'utf8').split('\n').length - 1;
    expect(lines).toBeLessThanOrEqual(MAX_LINES);
  });

  it('passes the shipped scoped guard, not a re-implementation of it', () => {
    const res = guard(['--only', PAGE]);
    expect(res.code, res.out).toBe(0);
  });

  it('leaves the repo-wide guard green — the extraction created no new oversized file', () => {
    const res = guard([]);
    expect(res.code, res.out).toBe(0);
  });
});

describe('#3429 — the refactor is code motion, so the page still says the same things', () => {
  it('renders every section anchor the page has always had', () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    for (const id of ['why', 'scale', 'features', 'tour', 'integrations', 'compare', 'pricing', 'faq']) {
      expect(html, `section id="${id}" vanished`).toContain(`id="${id}"`);
    }
  });

  // One distinctive fragment per section, quoted from the revision before the
  // split, so a lost or half-moved section shows up as a failure here.
  const COPY: Array<[string, string]> = [
    ['hero kicker', 'The customer operating system'],
    ['hero lead', 'Sales, support, billing and marketing come together'],
    ['module marquee', 'switch on what you need'],
    ['the stack heading', 'twelve tools that'],
    ['the stack before', 'Workflow automation'],
    ['the stack after', 'One permission model, so access rules apply everywhere at once'],
    ['stats', 'Purpose-built screens'],
    ['bento heading', 'Eight jobs, one product'],
    ['bento tile', 'Unlimited pipelines'],
    ['tour heading', 'This is what the work actually looks like'],
    ['tour tab body', 'It writes the follow-up you keep postponing'],
    ['industries heading', 'Configured before you log in'],
    ['integrations heading', 'yes'],
    ['integrations bullet', 'no waiting for us to build a logo tile'],
    ['security heading', 'Built for the person who has to sign it off'],
    ['security QA', 'Do you train models on it?'],
    ['compare heading', 'Honestly, next to the alternatives'],
    ['compare teaser chip', 'NuCRM vs Pipedrive'],
    ['pricing heading', 'Per user, plus the modules you switch on'],
    ['pricing plan', 'Most teams'],
    ['faq heading', 'The things people ask before signing up'],
  ];

  for (const [label, text] of COPY) {
    it(`still renders the ${label} copy`, () => {
      const html = renderToStaticMarkup(createElement(LandingPage));
      expect(html).toContain(text);
    });
  }

  it('keeps the copy it moved out of the page present exactly once in the marketing tree', () => {
    // A move that leaves the old literal behind would pass the render checks
    // (the page renders the new one) while silently forking the copy.
    const sources = [
      ...walk(join(ROOT, 'lib/marketing')),
      ...walk(join(ROOT, 'components/marketing')),
      join(ROOT, PAGE),
    ].map((f) => readFileSync(f, 'utf8'));
    for (const unique of [
      'It writes the follow-up you keep postponing',
      'Draw the process once, then stop thinking about it',
      'Twelve subscriptions, twelve sources of truth',
      'Backups, selective restore, trash, undo',
      'No. And you can supply your own AI provider key.',
    ]) {
      expect(sources.filter((s) => s.includes(unique))).toHaveLength(1);
    }
  });
});
