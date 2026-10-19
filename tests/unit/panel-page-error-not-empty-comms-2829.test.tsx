// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the four tenant panels whose only failure channel is a toast.
 *
 * These are the second shape in the baseline: the page *does* know the read failed,
 * spends that knowledge on `toast.error(...)`, and then prints "there are none"
 * anyway. A toast lasts four seconds; the sentence stays for as long as the tab is
 * open, and four of these pages also derive numbers off the list they never got.
 * Measured on `main` before the fix, with the repo's own screen (`inspect()` from
 * `scripts/check-panel-error-state.mjs`) and by reading each render body:
 *
 *   - `activities`       — `useEffect(() => { if (error) toast.error('Failed to load
 *     activities') }, [error])`, then `<EmptyState title="No activity yet"
 *     description="…created deals, updated contacts, sent emails — will appear here
 *     as your team works.">`. The workspace's record of what has already happened,
 *     reporting that nothing has.
 *   - `sms`              — `if (messagesError) toast.error('Failed to load messages')`
 *     in the render body (so it re-fired on every render), and because all four stat
 *     cards are counted off `messages`, a refusal reported Total 0 / Sent 0 /
 *     Delivered 0 / **Failed 0** above "No messages found / Send your first SMS to get
 *     started". An outbound message log that says nothing went out and nothing failed
 *     is the most misleading all-clear in the app.
 *   - `forms`            — **two** sites. The list read destructured neither `error`
 *     nor `refetch` and printed "No forms yet / Build a lead capture form and embed it
 *     on any website in seconds" with a button that starts a duplicate of a live form
 *     (forms have public embed URLs). The submissions drawer bound `error`, toasted it
 *     from an effect, and drew "No submissions yet / Share your form link…" — telling
 *     whoever is chasing a lead that the form collected nothing.
 *   - `email-templates`  — render-body toast, a header that counted the unread read
 *     ("0 templates"), and "No templates yet / Create your first template". These are
 *     the templates sequences and automations send.
 *
 * Per panel: failed read → `role="alert"` naming that read, the false-empty sentence
 * unreachable, "Try again" wired to *that* read's `refetch`, the failure announced from
 * the banner rather than the render body or an effect; succeeded-and-empty → the
 * sentence, no alert; rows → the rows, no alert. Then the parts only these pages have:
 * the four derived SMS counters and the template-count header going `—` instead of 0,
 * the empty-state CTAs ("Compose SMS", "Create your first template") being gone under a
 * failure, and `forms`' two independent reads — a failed submissions read must banner
 * inside the drawer while the list beside it stays on screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import ActivitiesPage from '@/app/tenant/activities/page';
import SmsPage from '@/app/tenant/sms/page';
import FormsPage from '@/app/tenant/forms/page';
import EmailTemplatesPage from '@/app/tenant/email-templates/page';

const NOW = '2026-10-01T00:00:00Z';
// Each page builds its url from its own filter/pagination state; these are the
// defaults a fresh render asks for. `sms` with filter 'all' keeps the '?' because
// URLSearchParams is empty — that is the key the page actually queries with.
const ACTIVITIES = '/api/tenant/activities?limit=50&offset=0';
const SMS = '/api/tenant/sms?';
const FORMS = '/api/tenant/forms?limit=20&offset=0';
const FORM_SUBS = '/api/tenant/forms/fm-1';
const EMAIL_TEMPLATES = '/api/tenant/email-templates';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** A stat card's whole text, looked up from its label so the number is tied to the
 *  read it is derived from. */
function card(label: string): string {
  const el = screen.getByText(label, { selector: 'p' });
  return el.closest('.admin-card')?.textContent ?? '';
}

// ── fixtures, shaped like each endpoint's own response ─────────────────────────
const activityRows = {
  data: [
    {
      id: 'ac-1', action: 'deal.create', entity_type: 'deal', entity_id: 'd-9',
      description: 'Signed Northwind Grocers', user_name: 'Priya Raman', created_at: NOW,
    },
    {
      id: 'ac-2', action: 'contact.update', entity_type: 'contact', entity_id: 'c-4',
      description: 'Corrected the billing email', user_name: 'Nadia Farouk', created_at: NOW,
    },
  ],
};

const smsRows = {
  data: [
    {
      id: 'sm-1', to: '+15550100', from: '+15550900', body: 'Your report is ready',
      direction: 'outbound', status: 'delivered', templateId: null, createdAt: NOW,
    },
    {
      id: 'sm-2', to: '+15550101', from: '+15550900', body: 'Retry scheduled',
      direction: 'outbound', status: 'delivered', templateId: null, createdAt: NOW,
    },
    {
      id: 'sm-3', to: '+15550102', from: '+15550900', body: 'Meeting tomorrow',
      direction: 'outbound', status: 'sent', templateId: null, createdAt: NOW,
    },
    {
      id: 'sm-4', to: '+15550103', from: '+15550900', body: 'Carrier rejected',
      direction: 'outbound', status: 'failed', templateId: null, createdAt: NOW,
    },
  ],
};

const formRows = {
  data: [
    {
      id: 'fm-1', name: 'Website enquiry', is_active: true,
      fields: [{ key: 'first_name', label: 'First Name', type: 'text', required: true }],
      submissions_count: 12, views_count: 340,
    },
    {
      id: 'fm-2', name: 'Demo booking', is_active: false, fields: [],
      submissions_count: 0, views_count: 90,
    },
  ],
  total: 2,
};

const submissionRows = {
  data: {
    submissions: [
      {
        id: 'sb-1', first_name: 'Iman', last_name: 'Haddad', contact_email: 'iman@northwind.example',
        data: { message: 'Wants a demo next week' }, created_at: NOW,
      },
    ],
  },
};

const templateRows = {
  data: [
    {
      id: 'et-1', name: 'Welcome sequence', subject: 'Welcome aboard', body: '<p>Hi</p>',
      category: 'onboarding', created_at: NOW, updated_at: NOW,
    },
    {
      id: 'et-2', name: 'Invoice reminder', subject: 'Invoice due', body: '<p>Hi</p>',
      category: 'billing', created_at: NOW, updated_at: NOW,
    },
  ],
};

type Panel = {
  key: string;
  Page: () => ReactNode;
  failUrl: string;
  withFailure: Record<string, QueryResult>;
  /** the "there are none" claim the page used to make */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  empty: Record<string, QueryResult>;
  rows: Record<string, QueryResult>;
  rowText: RegExp;
  /** every one of these four had a toast as its only failure channel at base */
  toastedAtBase: true;
};

const PANELS: Panel[] = [
  {
    key: 'activities',
    Page: ActivitiesPage,
    failUrl: ACTIVITIES,
    withFailure: { [ACTIVITIES]: failed('Request failed (502)') },
    sentence: /No activity yet/,
    phrase: /activity log|activities/i,
    empty: { [ACTIVITIES]: ok({ data: [] }) },
    rows: { [ACTIVITIES]: ok(activityRows) },
    rowText: /Signed Northwind Grocers/,
    toastedAtBase: true,
  },
  {
    key: 'sms',
    Page: SmsPage,
    failUrl: SMS,
    withFailure: { [SMS]: failed('Request failed (503)') },
    sentence: /No messages found/,
    phrase: /message log|sms/i,
    empty: { [SMS]: ok({ data: [] }) },
    rows: { [SMS]: ok(smsRows) },
    rowText: /Your report is ready/,
    toastedAtBase: true,
  },
  {
    key: 'forms',
    Page: FormsPage,
    failUrl: FORMS,
    withFailure: { [FORMS]: failed('Request failed (500)') },
    sentence: /No forms yet/,
    phrase: /forms/i,
    empty: { [FORMS]: ok({ data: [], total: 0 }) },
    rows: { [FORMS]: ok(formRows) },
    rowText: /Website enquiry/,
    toastedAtBase: true,
  },
  {
    key: 'email-templates',
    Page: EmailTemplatesPage,
    failUrl: EMAIL_TEMPLATES,
    withFailure: { [EMAIL_TEMPLATES]: failed() },
    sentence: /No templates yet/,
    phrase: /email templates|templates/i,
    empty: { [EMAIL_TEMPLATES]: ok({ data: [] }) },
    rows: { [EMAIL_TEMPLATES]: ok(templateRows) },
    rowText: /Welcome sequence/,
    toastedAtBase: true,
  },
];

describe('a refused tenant read is not reported as "there are none" (#2829)', () => {
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
        expect(alerts()).toMatch(/failed|did not (load|answer)|could not be read/i);
        expect(
          screen.queryAllByText(p.sentence).length,
          `${p.key}: still states the absence`,
        ).toBe(0);
      });

      it('keeps its honest sentence when the read answers with none', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(
          screen.queryAllByText(p.sentence).length,
          `${p.key}: the sentence went missing`,
        ).toBeGreaterThan(0);
        expect(alerts(), `${p.key}: an outage banner on a read that succeeded`).toBe('');
      });

      it('shows the rows the read actually returned', () => {
        registry.byUrl = { ...p.rows };
        wrapped(<p.Page />);
        expect(
          screen.queryAllByText(p.rowText).length,
          `${p.key}: its own row went missing`,
        ).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('announces the failure from the banner, not the render body or an effect', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, `${p.key} toasts on the first render`).not.toHaveBeenCalled();
        rerender(tree(<p.Page />));
        expect(toast.error, `${p.key} toasts again on every re-render`).not.toHaveBeenCalled();
      });
    });
  }
});

describe('the SMS cards count messages, so an unread list makes them unavailable (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const CARDS: { label: string; onRows: string }[] = [
    { label: 'Total Messages', onRows: '4' },
    { label: 'Sent', onRows: '1' },
    { label: 'Delivered', onRows: '2' },
    { label: 'Failed', onRows: '1' },
  ];

  it('refuses to state a derived number for a read that never answered', () => {
    registry.byUrl = { [SMS]: failed('Request failed (503)') };
    wrapped(<SmsPage />);
    for (const c of CARDS) {
      const text = card(c.label);
      expect(text, `${c.label} states a number the read never returned`).toContain('—');
      expect(text, `${c.label} still prints the 0 it derived from nothing`).not.toContain(c.onRows);
    }
  });

  it('states the counts it actually read', () => {
    registry.byUrl = { [SMS]: ok(smsRows) };
    wrapped(<SmsPage />);
    for (const c of CARDS) {
      expect(card(c.label), `${c.label} went wrong while the read was fine`).toContain(c.onRows);
    }
    expect(alerts()).toBe('');
  });

  it('keeps the composer reachable, without the empty-state CTA that claims nothing was sent', () => {
    registry.byUrl = { [SMS]: failed() };
    wrapped(<SmsPage />);
    expect(screen.queryByText('Send your first SMS to get started')).toBeNull();
    // One Compose button (the header) instead of two: the empty state's is gone, and
    // the header one still opens the dialog, so a failed read does not strand the page.
    expect(screen.queryAllByRole('button', { name: /compose sms/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /compose sms/i }));
    expect(screen.getByPlaceholderText(/\+1|number|to/i)).toBeTruthy();
  });

  it('says "Send your first SMS to get started" with no alert when the log really is empty', () => {
    registry.byUrl = { [SMS]: ok({ data: [] }) };
    wrapped(<SmsPage />);
    expect(screen.getByText('Send your first SMS to get started')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /compose sms/i })).toHaveLength(2);
    expect(alerts()).toBe('');
    expect(card('Failed')).toContain('0');
  });

  it('re-runs the messages read, not the templates read beside it', () => {
    registry.byUrl = { [SMS]: failed(), '/api/tenant/sms/templates': ok({ data: [] }) };
    wrapped(<SmsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SMS].refetch).toHaveBeenCalled();
    expect(registry.byUrl['/api/tenant/sms/templates'].refetch).not.toHaveBeenCalled();
  });
});

describe('forms has two reads and they fail separately (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const openDrawer = () => {
    fireEvent.click(screen.getAllByRole('button', { name: /submissions/i })[0]);
  };

  it('banners inside the drawer and keeps the list beside it on screen', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: failed('Request failed (500)') };
    wrapped(<FormsPage />);
    openDrawer();
    expect(alerts()).toMatch(/submissions/i);
    expect(alerts()).toMatch(/failed|could not be read/i);
    expect(screen.queryByText('No submissions yet')).toBeNull();
    // the failure is the drawer's, not the page's — both rows are still listed
    expect(screen.getByText('Website enquiry', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Demo booking', { selector: 'p' })).toBeTruthy();
  });

  it('routes the drawer retry to that form, not to the forms list', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: failed() };
    wrapped(<FormsPage />);
    openDrawer();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[FORM_SUBS].refetch).toHaveBeenCalled();
    expect(registry.byUrl[FORMS].refetch).not.toHaveBeenCalled();
  });

  it('announces a failed submissions read once, in the drawer', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: failed() };
    const { rerender } = wrapped(<FormsPage />);
    openDrawer();
    expect(toast.error).not.toHaveBeenCalled();
    rerender(tree(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FormsPage />
      </QueryClientProvider>,
    ));
    expect(toast.error, 're-fires on every render, which is what the effect did').not.toHaveBeenCalled();
  });

  it('shows the submission it read, and the honest "No submissions yet" for a form that really has none', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: ok(submissionRows) };
    wrapped(<FormsPage />);
    openDrawer();
    expect(screen.getByText(/Iman/)).toBeTruthy();
    expect(alerts()).toBe('');

    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: ok({ data: { submissions: [] } }) };
    wrapped(<FormsPage />);
    openDrawer();
    expect(screen.getByText('No submissions yet')).toBeTruthy();
    expect(alerts(), 'a form with no submissions is not an outage').toBe('');
  });

  it('keeps the "Build a lead capture form" CTA for a workspace that really has no forms', () => {
    registry.byUrl = { [FORMS]: ok({ data: [], total: 0 }) };
    wrapped(<FormsPage />);
    expect(screen.getByText('No forms yet')).toBeTruthy();
    expect(screen.getByText('Build a lead capture form and embed it on any website in seconds')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('does not offer to build the first form when the read never came back', () => {
    registry.byUrl = { [FORMS]: failed('Request failed (500)') };
    wrapped(<FormsPage />);
    expect(screen.queryByText('Build a lead capture form and embed it on any website in seconds')).toBeNull();
    expect(screen.queryByRole('button', { name: /build first form/i })).toBeNull();
  });
});

describe('the email-template count is derived from the templates it never read (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('shows an em dash where it would have counted zero templates', () => {
    registry.byUrl = { [EMAIL_TEMPLATES]: failed() };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('—', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText(/^[0-9]+ templates?$/)).toBeNull();
    expect(screen.queryByText('Create reusable email templates for sequences, automations, and manual sends.')).toBeNull();
    expect(screen.queryByRole('button', { name: /create your first template/i })).toBeNull();
  });

  it('counts them when the read answers — singular and plural both', () => {
    registry.byUrl = { [EMAIL_TEMPLATES]: ok(templateRows) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('2 templates')).toBeTruthy();
    expect(alerts()).toBe('');

    registry.byUrl = { [EMAIL_TEMPLATES]: ok({ data: [templateRows.data[0]] }) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('1 template')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('keeps the create-CTA and the zero count for a workspace that really has none', () => {
    registry.byUrl = { [EMAIL_TEMPLATES]: ok({ data: [] }) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('No templates yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /create your first template/i })).toBeTruthy();
    expect(screen.getByText('0 templates')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('activities: the log is the record, so its banner must not be a prose paragraph (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('replaces the whole empty-state block, not just its title', () => {
    registry.byUrl = { [ACTIVITIES]: failed('Request failed (502)') };
    wrapped(<ActivitiesPage />);
    expect(alerts()).toMatch(/activity log/i);
    expect(
      screen.queryByText(/will appear here as your team works/),
      'the description promising activity will show up once the team works',
    ).toBeNull();
  });

  it('keeps the paging controls live under the banner', () => {
    registry.byUrl = { [ACTIVITIES]: failed() };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('Page 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('states the actions it read', () => {
    registry.byUrl = { [ACTIVITIES]: ok(activityRows) };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('deal.create')).toBeTruthy();
    expect(screen.getByText('Priya Raman')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('re-runs the activities read only', () => {
    registry.byUrl = { [ACTIVITIES]: failed(), [EMAIL_TEMPLATES]: ok(templateRows) };
    wrapped(<ActivitiesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ACTIVITIES].refetch).toHaveBeenCalled();
    expect(registry.byUrl[EMAIL_TEMPLATES].refetch).not.toHaveBeenCalled();
  });
});

describe('the ratchet decayed by exactly these four (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/activities/page.tsx',
    'app/tenant/sms/page.tsx',
    'app/tenant/forms/page.tsx',
    'app/tenant/email-templates/page.tsx',
  ];

  function baselineKeys() {
    const doc = JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    return Object.keys(doc.files);
  }

  it('is still green, and still counts what the baseline actually holds', () => {
    const keys = baselineKeys();
    // 24 when this class was cut, 20 when #2855 landed. The slices in flight (#2851's
    // five `ai/*` pages, #2857's four `reports/*` pages) each delete more, so this is a
    // ceiling rather than a number — pinning the exact count is what #2858 had to undo.
    expect(keys.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain(`OK — ${keys.length} panel(s)`);
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale').not.toContain('no longer offends');
  });

  it('no longer carries any of the four', () => {
    const files = baselineKeys();
    for (const f of FILES) {
      expect(files, `${f} stayed on the list after being fixed`).not.toContain(f);
    }
  });

  it('and the screen now sees what it saw before: each page reads its failure and shows it', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still offends the screen`).toBe(false);
      // The removal is honest: the page binds the failure AND renders for it.
      expect(src, `${f} does not bind error`).toMatch(/\berror\b/);
      expect(src, `${f} binds error and never renders it`).toMatch(/InlineErrorState/);
    }
  });

  it('leaves no load-failure toast behind on these four pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure from the render body`).not.toMatch(
        /if \((?:error|\w*[Ee]rror)\)\s*toast\.error/,
      );
      expect(src, `${f} still routes a read failure through an effect`).not.toMatch(
        /useEffect\(\s*\(\)\s*=>\s*\{\s*if \(\w*[Ee]rror\)/,
      );
    }
  });

  it('keeps every file it touches inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
