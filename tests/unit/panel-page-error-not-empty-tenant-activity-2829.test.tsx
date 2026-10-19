// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, engagement-log slice — `activities`, `meetings`, `sms`, `visitors`.
 *
 * Measured on `8beeec0c` with the repo's own screen (`inspect()` from
 * `scripts/check-panel-error-state.mjs`), before any of this was written:
 *
 *   - `activities:77`      — `No activity yet`, `error` bound and spent on
 *     `useEffect(() => { if (error) toast.error('Failed to load activities') }, [error])`.
 *   - `meetings:139`       — `No meetings yet. Create your first meeting above.`, with
 *     `if (error) toast.error(...)` in the **render body**, so it re-fired every render.
 *   - `sms:186`            — `No messages found` plus a Compose CTA, same render-body toast.
 *   - `visitors:137`       — `No visitors found`, same render-body toast.
 *
 * Two things the screen cannot see, and both are pinned here.
 *
 * First, each refusal also produced **numbers**. `sms` counts Total / Sent / Delivered /
 * Failed messages off the read, `visitors` counts Total / Identified / Anonymous / Avg
 * Score — all four of each were reading `0` off `?? []`, and `avgScore` special-cased
 * empty to `0` so it looked like a measured average of zero rather than no measurement.
 * `activities` produced a different derived claim: `Next` was disabled by
 * `activities.length < limit`, so an unread feed asserted "this is the last page".
 *
 * Second, `sms` has a **read nobody can see fail**: the compose dialog's picker calls
 * `/api/tenant/sms/templates` with `const { data: templatesData } = useApiQuery(...)` —
 * no `error`, no `refetch`. A refused template list left a dropdown whose only entry was
 * "Select a template…", which is the option-list shape where "none" and "unread" are
 * indistinguishable from the operator's side of the screen.
 *
 * The honest arms stay honest, which is the part a blanket `error ?` gate gets wrong.
 * `sms`'s status tabs and `visitors`' type/score controls are **server-side**, so a
 * successful read that returns nothing under `failed` or `identified` is a real answer
 * about that view — those now say so instead of claiming the whole inbox/site is empty.
 * And because every one of these queries is invalidated by its own mutations, a failed
 * *refresh* has to keep the rows: that is a second state, tested separately, not the
 * outage banner replacing data the operator is looking at.
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

import ActivitiesPage from '@/app/tenant/activities/page';
import MeetingsPage from '@/app/tenant/meetings/page';
import SmsPage from '@/app/tenant/sms/page';
import VisitorsPage from '@/app/tenant/visitors/page';

const NOW = '2026-10-01T00:00:00Z';
// Both list pages build their query string with URLSearchParams and no default params,
// so the URL they ask for really does end in `?`.
const URLS = {
  activities: '/api/tenant/activities?limit=50&offset=0',
  meetings: '/api/tenant/meetings',
  sms: '/api/tenant/sms?',
  smsFailed: '/api/tenant/sms?status=failed',
  templates: '/api/tenant/sms/templates',
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
const activityRows = {
  data: [{
    id: 'act1', action: 'deal.update', entity_type: 'deal',
    description: 'Moved Northwind to Won', user_id: 'u1', user_name: 'Priya Kulkarni',
    created_at: NOW,
  }],
};
const meetingRows = {
  data: [{
    id: 'mt1', title: 'Quarterly review', description: 'Q3 account readout',
    start_time: NOW, end_time: NOW, location: 'War Room',
    meeting_url: 'https://meet.example.invalid/qr', status: 'scheduled', created_at: NOW,
  }],
};
const smsRows = {
  data: [
    {
      id: 'sm1', to: '+15550001111', from: '+15550009999', body: 'Renewal is due Friday',
      direction: 'outbound', status: 'sent', templateId: null, createdAt: NOW,
    },
    {
      id: 'sm2', to: '+15550009999', from: '+15550001111', body: 'Thanks, sending now',
      direction: 'inbound', status: 'delivered', templateId: null, createdAt: NOW,
    },
  ],
};
const templateRows = {
  data: [{ id: 'stm1', name: 'Renewal reminder', body: 'Your renewal is due on the 1st.', variables: ['date'] }],
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
 * A stat card's whole text, found by walking up from its caption to the card. The
 * caption is a `p` on both pages here; the value is a sibling two levels up on
 * `visitors` (its caption sits inside the icon row) and one level up on `sms`, so the
 * walk starts from the caption and climbs to the nearest `.admin-card`, which is the
 * same card for both shapes. Asserting through the card rather than a global
 * `getByText('0')` keeps these honest: the number is only wrong because of WHICH read
 * it is derived from.
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
    key: 'activities',
    Page: ActivitiesPage,
    failUrl: URLS.activities,
    withFailure: { [URLS.activities]: failed('Request failed (503)') },
    sentence: /No activity yet/,
    phrase: /activity feed/i,
    empty: { [URLS.activities]: ok({ data: [] }) },
    rows: { [URLS.activities]: ok(activityRows) },
    rowText: 'Moved Northwind to Won',
    numbers: [],
    stale: { [URLS.activities]: staleRead(activityRows) },
  },
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
    key: 'sms',
    Page: SmsPage,
    failUrl: URLS.sms,
    withFailure: { [URLS.sms]: failed(), [URLS.templates]: ok(templateRows) },
    sentence: /No messages found/,
    phrase: /SMS messages/i,
    empty: { [URLS.sms]: ok({ data: [] }), [URLS.templates]: ok(templateRows) },
    rows: { [URLS.sms]: ok(smsRows), [URLS.templates]: ok(templateRows) },
    rowText: 'Renewal is due Friday',
    numbers: [
      { label: 'Total Messages', onRows: '2' },
      { label: 'Sent', onRows: '1' },
      { label: 'Delivered', onRows: '1' },
      { label: 'Failed', onRows: '0' },
    ],
    stale: { [URLS.sms]: staleRead(smsRows), [URLS.templates]: ok(templateRows) },
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

describe('activities: the pager stops asserting a page count it never read (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const next = () => screen.getByRole('button', { name: /next/i });

  it('does not disable "Next" as if it had proved this is the last page', () => {
    // `activities.length < limit` read the empty fallback and concluded "one page,
    // that is all there is" from a request that never answered.
    registry.byUrl = { [URLS.activities]: failed() };
    wrapped(<ActivitiesPage />);
    expect(next().hasAttribute('disabled'), 'the failure disabled a navigation control').toBe(false);
  });

  it('still disables "Next" for a short page it genuinely read', () => {
    registry.byUrl = { [URLS.activities]: ok(activityRows) };
    wrapped(<ActivitiesPage />);
    expect(next().hasAttribute('disabled'), 'a 1-row page under the 50 limit is the last page').toBe(true);
    expect(alerts()).toBe('');
  });

  it('keeps "Prev" and the page label usable while the failure is on screen', () => {
    registry.byUrl = { [URLS.activities]: failed() };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('Page 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /prev/i }).hasAttribute('disabled')).toBe(true);
  });
});

describe('sms: the compose dialog\'s template picker (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const openTemplatePicker = () => {
    wrapped(<SmsPage />);
    fireEvent.click(screen.getByRole('button', { name: /compose sms/i }));
    fireEvent.click(screen.getByRole('button', { name: /use template/i }));
  };

  it('says the templates failed instead of showing an empty dropdown', () => {
    registry.byUrl = { [URLS.sms]: ok(smsRows), [URLS.templates]: failed('Request failed (500)') };
    openTemplatePicker();
    expect(alerts()).toMatch(/templates/i);
    // The picker is the page's only select, and it is gone: no dropdown whose sole
    // entry is "Select a template…".
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('names the template read that failed, not the inbox it did read', () => {
    // The two reads are independent: an unread template list must not be reported as
    // an unread inbox, and the messages below the modal keep their real counts.
    registry.byUrl = { [URLS.sms]: ok(smsRows), [URLS.templates]: failed() };
    openTemplatePicker();
    expect(alerts()).toMatch(/templates/i);
    expect(alerts()).not.toMatch(/inbox|SMS messages/i);
    expect(card('Total Messages')).toContain('2');
  });

  it('keeps the picker usable and states a genuine "no templates" without an alert', () => {
    registry.byUrl = { [URLS.sms]: ok(smsRows), [URLS.templates]: ok({ data: [] }) };
    openTemplatePicker();
    expect(alerts()).toBe('');
    expect(screen.getByText(/No SMS templates saved yet/)).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('lists the templates for a read that answered', () => {
    registry.byUrl = { [URLS.sms]: ok(smsRows), [URLS.templates]: ok(templateRows) };
    openTemplatePicker();
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByText('Renewal reminder')).toBeTruthy();
    expect(screen.queryByText(/No SMS templates saved yet/)).toBeNull();
    expect(alerts()).toBe('');
  });

  it('keeps Compose reachable while the message read is failed', () => {
    registry.byUrl = { [URLS.sms]: failed(), [URLS.templates]: ok(templateRows) };
    wrapped(<SmsPage />);
    expect(screen.queryByText(/No messages found/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /compose sms/i }));
    expect(screen.getByRole('heading', { name: 'Compose SMS' })).toBeTruthy();
  });

  it('keeps the status tabs as filters, not as a fake outage', () => {
    // Server-side filter: a read that answered with nothing under `failed` is an
    // answer about that status.
    registry.byUrl = {
      [URLS.sms]: ok(smsRows),
      [URLS.smsFailed]: ok({ data: [] }),
      [URLS.templates]: ok(templateRows),
    };
    wrapped(<SmsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.getByText('No failed messages')).toBeTruthy();
    expect(alerts()).toBe('');
  });
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

describe('the ratchet decayed by exactly these four (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/activities/page.tsx',
    'app/tenant/meetings/page.tsx',
    'app/tenant/sms/page.tsx',
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

  it('no longer carries any of the four', () => {
    const files = doc().files;
    // A ceiling, never an equality: #2851 and #2857 each delete entries of their own.
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
    // The second read, the one the screen cannot count at all: `sms` binds its
    // template failure too, and renders for it inside the compose dialog.
    const sms = readFileSync(join(ROOT, 'app/tenant/sms/page.tsx'), 'utf8');
    expect(sms).toMatch(/templatesError/);
    expect(sms).toMatch(/Failed to load the SMS templates/);
  });

  it('leaves no load-failure toast behind on these four pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure`).not.toMatch(/if \((?:error|\w*[Ee]rror)\)\s*toast\.error/);
    }
  });

  it('points the sibling suites\' owed-names at pages this slice did not touch', () => {
    // Two decay assertions carried my page names until now. Moved rather than deleted:
    // an empty sweep must not read as success, so the pin has to land on a real entry.
    const money = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-money-path-2829.test.tsx'), 'utf8');
    const lists = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx'), 'utf8');
    expect(money).toContain("'app/tenant/kb/page.tsx'");
    // The pointer moved rather than the old name being left as a live assertion — a
    // comment mentioning a fixed page is fine, `expect(f['…'])` on it is not.
    expect(money, 'the visitors pointer is still an assertion').not.toMatch(/expect\(f\['app\/tenant\/visitors\/page\.tsx'\]/);
    expect(lists).toContain("'app/tenant/pipelines/page.tsx'");
    expect(lists, 'the meetings pointer is still an assertion').not.toMatch(/expect\(files\['app\/tenant\/meetings\/page\.tsx'\]/);
    // And both new names are entries that still offend, so the pin proves something.
    expect(doc().files['app/tenant/kb/page.tsx']).toBeTruthy();
    expect(doc().files['app/tenant/pipelines/page.tsx']).toBeTruthy();
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
