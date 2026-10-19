// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, engagement-log slice — `meetings`, `visitors`.
 *
 * Measured on `8beeec0c` with the repo's own screen (`inspect()` from
 * `scripts/check-panel-error-state.mjs`), before any of this was written. The slice
 * started as four panels, `activities`, `meetings`, `sms` and `visitors`; #2862 landed
 * the first and the third while this was in review, so those two pages are its
 * implementation now and their cases went with them. What is left is the pair nobody
 * else touched:
 *
 *   - `meetings:139`  — `No meetings yet. Create your first meeting above.`, with
 *     `if (error) toast.error(...)` in the **render body**, so it re-fired every render.
 *   - `visitors:137`  — `No visitors found`, same render-body toast.
 *
 * Two things the screen cannot see, both pinned here.
 *
 * First, a refusal produces **numbers** as well as a sentence. `visitors` counts Total /
 * Identified / Anonymous / Avg Score off the read, all four of them reading `0` out of
 * `?? []`, and `avgScore` special-cased the empty list to `0` — so an unread panel did
 * not merely look thin, it asserted a measured average of zero. `meetings` has no stats
 * row, so the falsifiable claim there is the instruction under the empty state.
 *
 * Second, `sms` — which is where that lesson came from, and it is worth keeping on the
 * record because the page is now somebody else's. Its compose dialog's picker calls
 * `/api/tenant/sms/templates` as `const { data: templatesData } = useApiQuery(...)`: no
 * `error`, no `refetch`. A refused template list leaves a dropdown whose only entry is
 * "Select a template…", which is the option-list shape where "none" and "unread" are
 * indistinguishable from the operator's side of the screen. `guard:panel-error-state`
 * cannot see it: the screen asks whether the FILE renders an error state, and `sms`
 * renders one for its message read. Measured on `cdd2f715`, after #2862 landed it:
 * `app/tenant/sms/page.tsx:74` is still that destructure, and no test in this repo
 * covers it. Filed as **#2868** rather than fixed here — that page is #2862's, and
 * re-cutting it mid-review is the duplicate work this issue keeps having to apologise
 * for.
 *
 * The honest arms stay honest, which is the part a blanket `error ?` gate gets wrong.
 * `visitors`' type and score controls are **server-side**, so a read that answers with
 * nothing under `identified` is a real answer about that view — that now says so instead
 * of claiming the whole site is empty. And because every one of these queries is
 * invalidated by its own mutations, a failed *refresh* has to keep the rows: that is a
 * second state, tested separately, not the outage banner replacing data the operator is
 * looking at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import MeetingsPage from '@/app/tenant/meetings/page';
import VisitorsPage from '@/app/tenant/visitors/page';

const NOW = '2026-10-01T00:00:00Z';
// `visitors` builds its query string with URLSearchParams and no default params, so the
// URL it asks for really does end in `?`.
const URLS = {
  meetings: '/api/tenant/meetings',
  visitors: '/api/tenant/visitors?',
  visitorsIdentified: '/api/tenant/visitors?filter=identified',
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The other state: the read answered before, this refresh did not, the rows stay. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// ── fixtures: the shape each endpoint actually returns ─────────────────────────
const meetingRows = {
  data: [{
    id: 'mt1', title: 'Quarterly review', description: 'Q3 account readout',
    start_time: NOW, end_time: NOW, location: 'War Room',
    meeting_url: 'https://meet.example.invalid/qr', status: 'scheduled', created_at: NOW,
  }],
};
const visitorRows = {
  data: [
    {
      id: 'vs1', fingerprintId: 'fp-9f2c41', identifiedContactId: 'ct1',
      firstSeenAt: NOW, lastSeenAt: NOW, totalPageViews: 12, score: 80,
    },
    {
      id: 'vs2', fingerprintId: 'fp-7a1103', identifiedContactId: null,
      firstSeenAt: NOW, lastSeenAt: NOW, totalPageViews: 3, score: 20,
    },
  ],
};

/** Every alert's text joined — a page can raise more than one failure. */
function alerts(): string {
  return screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
}

/**
 * A stat card's whole text, found by walking up from its caption to the card. On
 * `visitors` the caption is a `p` sitting inside the icon row and the value is its
 * sibling two levels up, so the walk starts from the caption and climbs to the nearest
 * `.admin-card`, which is the same card whatever the shape. Asserting through the card
 * rather than a global `getByText('0')` keeps this honest: the number is only wrong
 * because of WHICH read it is derived from.
 */
function card(label: string): string {
  const el = screen.getByText(label, { selector: 'p' });
  return el.closest('.admin-card')?.textContent ?? '';
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => render(tree(node));

type Panel = {
  key: string;
  Page: () => ReactNode;
  failUrl: string;
  /** the read this case refuses */
  withFailure: Record<string, QueryResult>;
  /** the "there are none" claim it used to print */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  /** registry for a successful-but-empty render */
  empty: Record<string, QueryResult>;
  /** registry for a render with real rows */
  rows: Record<string, QueryResult>;
  rowText: string;
  /** labels whose card showed a derived 0, with the value the rows case proves */
  numbers: { label: string; onRows: string }[];
  /** registry for a failed refresh: rows + error together */
  stale: Record<string, QueryResult>;
};

const PANELS: Panel[] = [
  {
    key: 'meetings',
    Page: MeetingsPage,
    failUrl: URLS.meetings,
    withFailure: { [URLS.meetings]: failed() },
    sentence: /No meetings yet\. Create your first meeting above\./,
    phrase: /meetings/i,
    empty: { [URLS.meetings]: ok({ data: [] }) },
    rows: { [URLS.meetings]: ok(meetingRows) },
    rowText: 'Quarterly review',
    numbers: [],
    stale: { [URLS.meetings]: staleRead(meetingRows) },
  },
  {
    key: 'visitors',
    Page: VisitorsPage,
    failUrl: URLS.visitors,
    withFailure: { [URLS.visitors]: failed('Request failed (401)') },
    sentence: /No visitors found/,
    phrase: /visitors/i,
    empty: { [URLS.visitors]: ok({ data: [] }) },
    rows: { [URLS.visitors]: ok(visitorRows) },
    rowText: 'fp-9f2c41',
    numbers: [
      { label: 'Total Visitors', onRows: '2' },
      { label: 'Identified', onRows: '1' },
      { label: 'Anonymous', onRows: '1' },
      // The fixture scores 80 and 20; the old fallback special-cased the unread list
      // to exactly this value, so a refused read looked like a measured average of 0.
      { label: 'Avg Score', onRows: '50' },
    ],
    stale: { [URLS.visitors]: staleRead(visitorRows) },
  },
];

describe('a refused engagement-log read is not reported as "there are none" (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  for (const p of PANELS) {
    describe(p.key, () => {
      it('names the failed read instead of claiming the workspace has none', () => {
        registry.byUrl = { ...p.withFailure };
        expect(() => wrapped(<p.Page />)).not.toThrow();
        expect(alerts()).toMatch(p.phrase);
        expect(alerts()).toMatch(/failed|could not be read|did not answer/i);
        expect(screen.queryAllByText(p.sentence).length, `${p.key}: still states the absence`).toBe(0);
      });

      it('announces the failure once, in the banner — not from a toast that fades', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, 'the toast channel is what left the false sentence on screen').not.toHaveBeenCalled();
        rerender(tree(<p.Page />));
        expect(toast.error, 'and it must not return on re-render either').not.toHaveBeenCalled();
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('keeps its honest sentence for a successful read that returned nothing', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(screen.getAllByText(p.sentence).length).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('states what it actually read, with no failure on screen', () => {
        registry.byUrl = { ...p.rows };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toBe('');
        for (const n of p.numbers) {
          expect(card(n.label), `${n.label} on ${p.key}`).toContain(n.onRows);
        }
      });

      it('keeps the rows and says "last read" when only the refresh failed', () => {
        // Every one of these queries is invalidated by its own mutations, so this is
        // the common state, not a corner: replacing it with the outage banner would
        // hide the data the operator is looking at.
        registry.byUrl = { ...p.stale };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toMatch(/last read/i);
        expect(screen.queryAllByText(p.sentence).length).toBe(0);
      });

      if (p.numbers.length) {
        it('refuses to state a derived number for a read that never answered', () => {
          registry.byUrl = { ...p.withFailure };
          wrapped(<p.Page />);
          for (const n of p.numbers) {
            const text = card(n.label);
            expect(text, `${n.label} on ${p.key}: no dash`).toContain('—');
            expect(text, `${n.label} on ${p.key}: still quotes what it never read`).not.toContain(n.onRows);
          }
        });

        it('keeps the numbers it had already read when only the refresh failed', () => {
          registry.byUrl = { ...p.stale };
          wrapped(<p.Page />);
          for (const n of p.numbers) {
            expect(card(n.label), `${n.label} on ${p.key}: a failed refresh is not a zero`).toContain(n.onRows);
          }
        });
      }
    });
  }
});

describe('visitors: a filtered miss stays a filtered miss (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('states the view it filtered rather than the whole site when the view is empty', () => {
    registry.byUrl = {
      [URLS.visitors]: ok(visitorRows),
      [URLS.visitorsIdentified]: ok({ data: [] }),
    };
    wrapped(<VisitorsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Identified' }));
    expect(screen.getByText('No visitors match this view')).toBeTruthy();
    expect(screen.queryByText('No visitors found')).toBeNull();
    expect(alerts()).toBe('');
  });

  it('reports the outage rather than a filtered miss when the view never answered', () => {
    registry.byUrl = {
      [URLS.visitors]: failed(),
      [URLS.visitorsIdentified]: failed('Request failed (500)'),
    };
    wrapped(<VisitorsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Identified' }));
    expect(alerts()).toMatch(/visitors/i);
    expect(screen.queryByText(/No visitors (found|match this view)/)).toBeNull();
  });

  it('keeps sorting usable on a read that answered', () => {
    registry.byUrl = { [URLS.visitors]: ok(visitorRows) };
    wrapped(<VisitorsPage />);
    fireEvent.click(screen.getByRole('button', { name: /sort by score/i }));
    expect(screen.getByText('fp-9f2c41')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('meetings: the failure does not delete the form (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('replaces the "create your first meeting" instruction with the failure', () => {
    registry.byUrl = { [URLS.meetings]: failed('Request failed (401)') };
    wrapped(<MeetingsPage />);
    expect(alerts()).toMatch(/meetings/i);
    expect(screen.queryByText(/Create your first meeting above\./)).toBeNull();
  });

  it('still opens the create form over a failed read', () => {
    registry.byUrl = { [URLS.meetings]: failed() };
    wrapped(<MeetingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /new meeting/i }));
    expect(screen.getByText('Create Meeting')).toBeTruthy();
  });

  it('keeps the join link for a meeting it actually read', () => {
    registry.byUrl = { [URLS.meetings]: ok(meetingRows) };
    wrapped(<MeetingsPage />);
    expect(screen.getByText('War Room')).toBeTruthy();
    expect(screen.getByRole('link', { name: /join/i })).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet decayed by exactly these two (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/meetings/page.tsx',
    'app/tenant/visitors/page.tsx',
  ];
  const doc = () => JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
    files: Record<string, string>;
  };

  it('is still green, and counts exactly the panels the baseline carries', () => {
    // The number is read off the file rather than written as a literal, so a sibling
    // slice landing first cannot make this suite lie in either direction.
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`OK — ${Object.keys(doc().files).length} panel\\(s\\)`));
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale').not.toContain('no longer offends');
  });

  it('no longer carries any of the two', () => {
    const files = doc().files;
    // A ceiling, never an equality: #2851 and #2864 each delete entries of their own.
    expect(Object.keys(files).length).toBeLessThanOrEqual(16);
    for (const f of FILES) {
      expect(files, `${f} stayed on the list after being fixed`).not.toHaveProperty(f);
    }
  });

  it('each fixed page reads its failure and renders for it', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still offends the screen`).toBe(false);
      expect(src, `${f} does not bind error`).toMatch(/\berror\b/);
      expect(src, `${f} binds error and never renders it`).toMatch(/InlineErrorState/);
    }
  });

  it('leaves no load-failure toast behind on these two pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure`).not.toMatch(/if \((?:error|\w*[Ee]rror)\)\s*toast\.error/);
    }
  });

  it('leaves no owed-name pointing at a page this slice fixed', () => {
    // Two decay assertions carried my page names until now. A NAME is a bet against the
    // rest of #2829: money-path's has been re-cut four times because a different slice
    // fixed the page it named — superadmin/modules → visitors → kb → pipelines, every
    // one of them fixed on purpose. That is the same defect #2858 and #2865 filed for
    // memorised counts, wearing a page's name instead of a number. So the siblings check
    // the shape of the sweep rather than a name, and what remains here is the half that
    // cannot rot: a live assertion must not point at a page that is already honest.
    const siblings = [
      ['money-path', readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-money-path-2829.test.tsx'), 'utf8')],
      ['tenant-lists', readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx'), 'utf8')],
    ] as const;
    for (const [label, src] of siblings) {
      for (const f of FILES) {
        const dead = new RegExp(`expect\\((?:f|files)\\['${f.replace(/[/.]/g, '\\$&')}'\\]`);
        expect(src, `${label} still asserts the fixed ${f}`).not.toMatch(dead);
      }
      // And the reason a name was never load-bearing: the guard runs in both files, and
      // a page deleted from the baseline while it still prints an empty sentence over a
      // failed read is a NOVEL offender, which is what fails the guard.
      expect(src, `${label} stopped running the guard`).toMatch(/check-panel-error-state\.mjs/);
    }
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
