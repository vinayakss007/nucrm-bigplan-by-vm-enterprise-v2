// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2868 — the compose dialog's template picker on `app/tenant/sms/page.tsx`.
 *
 * The page arrived out of #2862 with its message read bound, its stat cards refusing to
 * count an unread list, and a banner with a retry. The template read beside it
 * (`/api/tenant/sms/templates`) still destructured only `data`, so when it refused the
 * picker under "Use Template" showed one option — "Select a template..." — which is
 * pixel-identical to what a tenant who has never saved a template sees, and nothing on
 * the screen could re-run it: the banner's retry refetches the messages.
 *
 * That shape is invisible to `scripts/check-panel-error-state.mjs` by construction. The
 * guard asks whether the *file* binds an error and renders one of
 * `InlineErrorState | ErrorFallback | role="alert"`; `sms` does both for its message read,
 * so it reports `offends: false` and the baseline stays green while a second read on the
 * same page answers "there are none". A page is only as honest as its worse read. The
 * last two cases in the file prove that blindness rather than assuming it.
 *
 * The split is the one #2869 put on the knowledge base: `failed` (never answered) replaces
 * the option list with the outage and its retry; `stale` (answered before, this refresh
 * did not) keeps the options the operator can still send with and says they are the last
 * read. `stale` is the common case here, because sending an SMS invalidates
 * `['tenant', 'sms']`, which prefix-matches the template query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

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

import SmsPage from '@/app/tenant/sms/page';

// `filter` starts at 'all', and the page builds the URL with an empty query string —
// the trailing '?' is part of the key the page actually asks for.
const SMS = '/api/tenant/sms?';
const TEMPLATES = '/api/tenant/sms/templates';

const NOW = '2026-03-04T10:00:00.000Z';
const messageRows = {
  data: [
    { id: 'm1', to: '+15550001111', from: null, body: 'Your delivery is on its way', direction: 'outbound', status: 'delivered', templateId: 't1', createdAt: NOW },
    { id: 'm2', to: '+15550002222', from: null, body: 'Your code is 4821', direction: 'outbound', status: 'failed', templateId: 't2', createdAt: NOW },
  ],
};
const templateRows = {
  data: [
    { id: 't1', name: 'Delivery notice', body: 'Your delivery is on its way', variables: [] },
    { id: 't2', name: 'OTP', body: 'Your code is {{code}}', variables: ['code'] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state the guard's own question cannot ask about: it answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** The dialog's copy of the failure, told apart from the page's banner by what it names. */
const templateAlert = () => {
  const found = screen.queryAllByRole('alert').filter((el) => /templates/i.test(el.textContent ?? ''));
  expect(found.length, `expected one alert about the template read, saw: ${alerts()}`).toBe(1);
  return found[0];
};

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** Opens the dialog and puts it in the mode where the option list is the whole screen. */
const openPicker = () => {
  wrapped(<SmsPage />);
  fireEvent.click(screen.getByRole('button', { name: /compose sms/i }));
  fireEvent.click(screen.getByRole('button', { name: /use template/i }));
};
const picker = () => screen.getByRole('combobox');
const optionTexts = () => [...picker().querySelectorAll('option')].map((o) => o.textContent);

describe('sms: the compose picker distinguishes an unread list from an empty one (#2868)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('names the read that failed instead of leaving a dropdown with only its placeholder', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: failed('Request failed (503)') };
    openPicker();
    expect(alerts()).toMatch(/Request failed \(503\)/);
    // The one-option dropdown was the whole bug: indistinguishable from "none saved".
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('No SMS templates saved yet')).toBeNull();
  });

  it('re-runs the template read from the dialog, not the message read the page is sitting on', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: failed() };
    openPicker();
    fireEvent.click(within(templateAlert()).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[TEMPLATES].refetch).toHaveBeenCalled();
    expect(registry.byUrl[SMS].refetch).not.toHaveBeenCalled();
  });

  it('says none are saved, with no alert, when that is what the read answered', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: ok({ data: [] }) };
    openPicker();
    expect(screen.getByText(/No SMS templates saved yet/i)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(optionTexts()).toEqual(['Select a template...']);
  });

  it('lists the options it read', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: ok(templateRows) };
    openPicker();
    expect(optionTexts()).toEqual(['Select a template...', 'Delivery notice', 'OTP']);
    expect(alerts()).toBe('');
    expect(screen.queryByText(/No SMS templates saved yet/i)).toBeNull();
  });
});

describe('sms: a refresh that failed keeps the options the operator can still send with (#2868)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the picker and says the list is the last read', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: staleRead(templateRows) };
    openPicker();
    expect(optionTexts()).toEqual(['Select a template...', 'Delivery notice', 'OTP']);
    expect(alerts()).toMatch(/last read/i);
    // The unread wording would tell the operator to go and re-save templates they can see.
    expect(alerts()).not.toMatch(/nothing to pick from/i);
    expect(screen.queryByText(/No SMS templates saved yet/i)).toBeNull();
  });

  it('still previews and still sends the template it had read', async () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: staleRead(templateRows) };
    openPicker();
    fireEvent.change(picker(), { target: { value: 't2' } });
    expect(screen.getByText('Your code is {{code}}')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/\+1|number|to/i), { target: { value: '+15555551234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^send sms$/i }));
    });
    const send = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalled();
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toMatchObject({ to: '+15555551234', templateId: 't2' });
  });

  it('does not call a failed refresh an empty list, even with no templates to keep', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: staleRead({ data: [] }) };
    openPicker();
    expect(screen.getByText(/No SMS templates saved yet/i)).toBeTruthy();
    // A last-read empty is still empty: the picker stays, and the banner adds the caveat.
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('sms: the dialog stays usable when only the option list is unread (#2868)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lets a free-text message be sent over the unread list, rather than stranding the compose', async () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: failed() };
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /direct message/i }));
    fireEvent.change(screen.getByPlaceholderText(/\+1|number|to/i), { target: { value: '+15555551234' } });
    fireEvent.change(screen.getByPlaceholderText(/type your message/i), { target: { value: 'Rescheduling to 6pm' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^send sms$/i }));
    });
    const send = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalled();
    const [, init] = send.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init.body))).toEqual({ to: '+15555551234', body: 'Rescheduling to 6pm' });
  });

  it('gives each banner its own retry when both reads refused', () => {
    registry.byUrl = { [SMS]: failed('Request failed (500)'), [TEMPLATES]: failed('Request failed (502)') };
    openPicker();
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
    const [message, template] = [
      screen.queryAllByRole('alert').find((el) => /message log/i.test(el.textContent ?? ''))!,
      templateAlert(),
    ];
    fireEvent.click(within(message).getByRole('button', { name: /try again/i }));
    fireEvent.click(within(template).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SMS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[TEMPLATES].refetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the inbox itself alone: the picker is not a page-wide outage', () => {
    registry.byUrl = { [SMS]: ok(messageRows), [TEMPLATES]: failed() };
    wrapped(<SmsPage />);
    expect(screen.getByText('Your delivery is on its way')).toBeTruthy();
    // The banner belongs to the dialog, so a page that has not opened it shows no outage
    // and no empty-state CTA either: the inbox reads are #2862's business, unchanged here.
    expect(alerts()).toBe('');
    expect(screen.queryByText('Send your first SMS to get started')).toBeNull();
  });
});

describe('the guard cannot see this read, so this suite is what does (#2868)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/sms/page.tsx';
  const baselineKeys = () =>
    Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = baselineKeys();
    // A ceiling, not a count: every other slice in #2829 deletes from this file, and
    // #2858/#2865/#2866 each had to undo a check that memorised how many were left.
    expect(files.length).toBeLessThanOrEqual(20);
    expect(files, 'sms went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('reports the page clean with the template read\'s error taken back out', async () => {
    // The regression guard is blind to: strip the binding this slice added and the file
    // still passes, because the *message* read already binds an error and the file already
    // renders `InlineErrorState`. So the assertions below — not the guard — are what fail
    // if someone reduces the picker back to a silent placeholder.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    const stripped = src.replace(
      /const \{ data: templatesData, error: templatesError, refetch: refetchTemplates \} = useApiQuery/,
      'const { data: templatesData } = useApiQuery',
    );
    expect(stripped, 'the shape this slice depends on moved').not.toBe(src);
    expect(inspect(FILE, src).offends).toBe(false);
    expect(inspect(FILE, stripped).offends, 'the guard would catch this one after all').toBe(false);
  });

  it('binds the two states apart rather than reading one error flag', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src).toMatch(/Boolean\(templatesError\) && !templatesData/);
    expect(src).toMatch(/Boolean\(templatesError\) && Boolean\(templatesData\)/);
    expect(src).toMatch(/templatesError\?\.message \|\| 'no response from the server'/);
    expect(src, 'a toast that fades is not a page state').not.toMatch(/if \(templatesError\)\s*toast\.error/);
  });

  it('does not overlap the suite that owns the message read', () => {
    // #2862's coverage of this page stops at the inbox; nothing there asserts the picker,
    // so the cases above are the only ones standing between this dialog and the
    // one-option dropdown. If that changes, the duplication is a merge-time conversation,
    // not a silent divergence.
    const comms = readFileSync(
      join(ROOT, 'tests/unit/panel-page-error-not-empty-comms-2829.test.tsx'),
      'utf8',
    );
    expect(comms, 'the comms suite now speaks about the template picker too').not.toMatch(/Use Template/);
    expect(comms).toMatch(/re-runs the messages read, not the templates read beside it/);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
