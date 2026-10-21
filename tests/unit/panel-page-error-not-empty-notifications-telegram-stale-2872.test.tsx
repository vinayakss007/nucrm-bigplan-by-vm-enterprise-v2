// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two `app/tenant/settings` panels that carry a Telegram/notification read:
 * `/api/tenant/notifications/matrix` and `/api/user/telegram`. One read each, and each judged
 * by a single error flag, so "nothing has answered this session" and "this refresh was refused
 * over an answer the page is still holding" rendered identically.
 *
 * `settings/notifications` was fixed by #2829 for the never-answered half: `if (error) return
 * (…InlineErrorState…)` sits there already, because an unread matrix would otherwise render 27
 * events with every switch OFF — a policy the tenant never set, on the page that decides who gets
 * emailed. #2829 never asked the other question. TanStack Query keeps `data` when a revalidation of
 * a query that already succeeded fails, and this key gets revalidated without the page asking: the
 * inbox at `app/tenant/notifications/page.tsx` reloads with `invalidateQueries({ queryKey: ['tenant',
 * 'notifications'] })`, a PREFIX that matches `['tenant', 'notifications', 'matrix']`, so marking a
 * row read or clearing the inbox invalidates this settings read too — and tidying the inbox before
 * coming here to change what gets sent is the normal route through it. The page's own Save does not
 * reload anything (it only re-bases `original`), so right after saving a rule the ordinary state is
 * "kept matrix + error flag set", and `if (error)` answered that with an outage card: the switches,
 * the unsaved edits and Discard/Save all gone, for a reason the screen could not give.
 *
 * `settings/telegram` is the toast-only shape. Its failure channel was
 * `useEffect(() => { if (error) toast.error('Failed to load Telegram settings'); }, [error])` — four
 * seconds, then gone — and the form carried on stating the tenant's setup regardless. Nothing in the
 * app invalidates `['tenant', 'telegram']`, and the save/test PATCHes deliberately do not (the token
 * is write-only since #2523, so a reload could not return what was typed); the refresh that fails is
 * the remount past the repo-wide `staleTime: 30_000`, and then the page is holding the previous
 * answer while `error` says it could not be confirmed. With nothing ever answered the same form
 * rendered its own defaults — "No bot configured yet" over a bot that is on file, the five security
 * alert types ON, Enable Notifications OFF — and Save armed to write that back.
 *
 * Neither page has an aggregate count. Their read-derived figures are the switch positions and the
 * per-row tri-state label (notifications) and the token-on-file statement, the masked hint
 * placeholder and the five toggle positions (telegram); all of them come from the kept payload on a
 * `stale` read and are unreachable on a `failed` one, which is why the outage card replaces the form
 * rather than sitting above it. Both pages' filters are client-side over a payload the page already
 * holds — the event search filters the static GROUPS catalogue and the notifications key carries no
 * filter — so neither is ever an "unread view": a search miss on a kept read stays a search miss.
 *
 * Per read: kept payload + "last read" caveat; the caveat retries its own read and not the other
 * page's; never-answered shows the outage with the reason and retires the absence sentence and the
 * form; a read that answered "there are none" still says so with no alert; stale over that answer
 * says none *and* caveats it; a refusal carrying no message falls back to "no response from the
 * server"; a kept control stays actionable. Fixtures are inert (`acme.test`, `Ada Operator`,
 * RFC-format chat IDs, a masked token hint).
 *
 * RED AT BASE — measured at `be35db54` (= `origin/main`, this branch's base) with both product
 * files untouched and this file as committed: **16 failed | 11 passed (27)**. Ten put a page in the
 * stale state (kept matrix + refused refresh, kept telegram settings + refused refresh, the
 * tri-state row label, the client-side search miss, the kept switch, the retry wired to the read, the
 * messageless refusal on both pages); one is `telegram`'s never-answered half, which at base rendered
 * the defaults and "No bot configured yet" instead of an outage; one pins that the load failure is no
 * longer carried by a fading toast; four are the source ratchets. The 11 that pass at base are
 * #2829's never-answered controls plus the guard/baseline/line-ceiling/overlap pins: replacing
 * `if (error)` with `if (failed)` is exactly the edit that must not break them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
/** Mocked so no case below can be satisfied by a toast — the banner is the channel. */
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import toast from 'react-hot-toast';
import NotificationsSettingsPage from '@/app/tenant/settings/notifications/page';
import TelegramSettingsPage from '@/app/tenant/settings/telegram/page';

const MATRIX = '/api/tenant/notifications/matrix';
const TELEGRAM = '/api/user/telegram';

const MATRIX_ROW = { matrix: { 'lead.created': { in_app: true, email: false, telegram: false } } };
const MATRIX_NONE = { matrix: {} };

const TG_STORED = {
  ok: true,
  settings: {
    telegram_bot_token_configured: true,
    telegram_bot_token_hint: '****4321',
    telegram_chat_id: '987654321',
    telegram_enabled: true,
    telegram_notify_login: true,
    telegram_notify_signup: false,
    telegram_notify_password_change: true,
    telegram_notify_2fa_change: true,
    telegram_notify_security_alerts: true,
  },
};
/** What the API really returns for a user who never set this up. */
const TG_NONE = {
  ok: true,
  settings: {
    telegram_bot_token_configured: false,
    telegram_bot_token_hint: null,
    telegram_chat_id: '',
    telegram_enabled: false,
    telegram_notify_login: true,
    telegram_notify_signup: true,
    telegram_notify_password_change: true,
    telegram_notify_2fa_change: true,
    telegram_notify_security_alerts: true,
  },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});
/** A refusal with no message — the copy must not print "undefined". */
const silentFailure = (withData?: unknown): QueryResult => ({
  data: withData,
  error: Object.assign(new Error(), { status: 504 }),
  isLoading: false,
  refetch: vi.fn(),
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

/** Every switch the 27-event matrix renders, three per event. */
const switches = () => screen.queryAllByRole('switch');
const onSwitches = () => switches().filter((el) => el.getAttribute('aria-checked') === 'true');

/**
 * Telegram's toggles are unlabelled buttons whose state lives in the class, so the position of a
 * named alert type is read off the row the label sits in — not off the page's text.
 */
const toggleState = (label: string): 'on' | 'off' => {
  const row = screen.getByText(label).closest('div[class*="justify-between"]');
  const button = row?.querySelector('button');
  expect(button, `${label} renders no toggle`).toBeTruthy();
  return /bg-violet-600/.test(button!.className) ? 'on' : 'off';
};

beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
afterEach(cleanup);

describe('notifications: a refused revalidation keeps the matrix (#2872)', () => {
  const OUTAGE = /Failed to load your notification settings/;
  const CAVEAT = /the choices below are the last read/;

  it('shows kept switches plus a last-read caveat, not an outage', () => {
    registry.byUrl = { [MATRIX]: staleRead(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    expect(screen.getByText('New lead created')).toBeTruthy();
    expect(onSwitches()).toHaveLength(1);
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).toContain('Request failed (504)');
    // The outage copy would be a lie: the matrix is on the screen.
    expect(screen.queryByText(OUTAGE)).toBeNull();
    expect(alerts()).not.toContain('Failed to load your notification settings');
  });

  it('the caveat retries the matrix read and not the telegram read', () => {
    const sibling = ok(TG_STORED);
    const result = staleRead(MATRIX_ROW);
    registry.byUrl = { [MATRIX]: result, [TELEGRAM]: sibling };
    wrapped(<NotificationsSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(sibling.refetch).not.toHaveBeenCalled();
  });

  it('an unread matrix is an outage that names the reason, with no switches and no caveat', () => {
    registry.byUrl = { [MATRIX]: failedRead('Request failed (500) — RLS refused the read') };
    wrapped(<NotificationsSettingsPage />);
    expect(alerts()).toContain('Failed to load your notification settings');
    expect(alerts()).toContain('Request failed (500)');
    expect(switches()).toHaveLength(0);
    expect(screen.queryByText('New lead created')).toBeNull();
    expect(alerts()).not.toContain('Could not refresh');
    // The absence sentence is unreachable: the page replaced itself, so there is no
    // search box to type into and nothing that can claim "no events".
    expect(screen.queryByPlaceholderText('Search events…')).toBeNull();
    expect(document.body.textContent).not.toContain('No events match');
  });

  it('a read that answered "everything off" says so with no alert', () => {
    registry.byUrl = { [MATRIX]: ok(MATRIX_NONE) };
    wrapped(<NotificationsSettingsPage />);
    expect(switches()).toHaveLength(81);
    expect(onSwitches()).toHaveLength(0);
    expect(alerts()).toBe('');
  });

  it('stale over an all-off answer keeps the switches and the caveat, and invents no outage', () => {
    registry.byUrl = { [MATRIX]: staleRead(MATRIX_NONE) };
    wrapped(<NotificationsSettingsPage />);
    expect(switches()).toHaveLength(81);
    expect(alerts()).toMatch(CAVEAT);
    expect(screen.queryByText(OUTAGE)).toBeNull();
  });

  it('a good read shows the stored ON with no alert', () => {
    registry.byUrl = { [MATRIX]: ok(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    expect(screen.getByText('New lead created')).toBeTruthy();
    expect(onSwitches()).toHaveLength(1);
    expect(alerts()).toBe('');
  });

  it('the row tri-state label follows the kept rows and dashes nothing', () => {
    // notifications has no aggregate number: its read-derived figure is per-row
    // On / Off / ~. On a refused revalidation it prints from the rows the page holds.
    registry.byUrl = { [MATRIX]: staleRead(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    expect(screen.getByTitle('Toggle all').textContent).toBe('~');
    expect(alerts()).not.toContain('—');
  });

  it('the client-side event search stays a search miss over a kept read', () => {
    registry.byUrl = { [MATRIX]: staleRead(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    fireEvent.change(screen.getByPlaceholderText('Search events…'), { target: { value: 'zzz' } });
    expect(document.body.textContent).toContain('No events match "zzz"');
    expect(alerts()).toMatch(CAVEAT);
    expect(screen.queryByText(OUTAGE)).toBeNull();
  });

  it('a kept switch stays actionable under the caveat and still arms Save', () => {
    registry.byUrl = { [MATRIX]: staleRead(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    const save = screen.getByRole('button', { name: /Save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(switches()[1]!);
    expect(save.disabled).toBe(false);
    expect(alerts()).toMatch(CAVEAT);
  });

  it('a refusal with no message falls back to no response from the server', () => {
    registry.byUrl = { [MATRIX]: silentFailure(MATRIX_ROW) };
    wrapped(<NotificationsSettingsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.getByText('New lead created')).toBeTruthy();

    registry.byUrl = { [MATRIX]: silentFailure() };
    wrapped(<NotificationsSettingsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('telegram: a refused revalidation keeps the settings it read (#2872)', () => {
  const OUTAGE = /Failed to load Telegram settings/;
  const CAVEAT = /the settings below are the last read/;
  const NONE = /No bot configured yet/;

  it('shows kept values plus a last-read caveat, not an outage', () => {
    registry.byUrl = { [TELEGRAM]: staleRead(TG_STORED) };
    wrapped(<TelegramSettingsPage />);
    expect(screen.getByDisplayValue('987654321')).toBeTruthy();
    expect(screen.getByText(/A bot token is on file/)).toBeTruthy();
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(OUTAGE)).toBeNull();
    expect(document.body.textContent).not.toContain('No bot configured yet');
  });

  it('the caveat retries the telegram read and not the matrix read', () => {
    const sibling = ok(MATRIX_ROW);
    const result = staleRead(TG_STORED);
    registry.byUrl = { [TELEGRAM]: result, [MATRIX]: sibling };
    wrapped(<TelegramSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(sibling.refetch).not.toHaveBeenCalled();
  });

  it('an unread config is an outage that names the reason, with no form to save over', () => {
    registry.byUrl = { [TELEGRAM]: failedRead('Request failed (500) — RLS refused the read') };
    wrapped(<TelegramSettingsPage />);
    expect(alerts()).toContain('Failed to load Telegram settings');
    expect(alerts()).toContain('Request failed (500)');
    // The defaults are the absence sentence and five switches ON — none of them the tenant's.
    expect(document.body.textContent).not.toContain('No bot configured yet');
    expect(screen.queryByText('Enable Notifications')).toBeNull();
    expect(screen.queryByText('Login Alerts')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save Settings/i })).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a read that answers "no bot yet" says so with no alert', () => {
    registry.byUrl = { [TELEGRAM]: ok(TG_NONE) };
    wrapped(<TelegramSettingsPage />);
    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stale over a "no bot yet" answer still says none, plus the caveat', () => {
    registry.byUrl = { [TELEGRAM]: staleRead(TG_NONE) };
    wrapped(<TelegramSettingsPage />);
    expect(screen.getByText(NONE)).toBeTruthy();
    expect(alerts()).toMatch(CAVEAT);
    expect(screen.queryByText(OUTAGE)).toBeNull();
  });

  it('a good read shows the stored setup with no alert', () => {
    registry.byUrl = { [TELEGRAM]: ok(TG_STORED) };
    wrapped(<TelegramSettingsPage />);
    expect(screen.getByDisplayValue('987654321')).toBeTruthy();
    expect(screen.getByPlaceholderText(/leave blank to keep/)).toBeTruthy();
    expect(screen.getByText(/A bot token is on file/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('the kept toggle positions come from the last read, not from the defaults', () => {
    // The five alert types default to ON and Enable Notifications defaults to OFF, so an
    // unread page used to state a setup nobody chose. On a refused revalidation the rows
    // print what the read returned, including the one type the tenant had switched off.
    registry.byUrl = { [TELEGRAM]: staleRead(TG_STORED) };
    wrapped(<TelegramSettingsPage />);
    expect(toggleState('Login Alerts')).toBe('on');
    expect(toggleState('New Signups')).toBe('off');
    expect(toggleState('Enable Notifications')).toBe('on');
    expect(screen.getByDisplayValue('987654321')).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('the kept form stays actionable under the caveat', async () => {
    const fetchStub = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchStub);
    registry.byUrl = { [TELEGRAM]: staleRead(TG_STORED) };
    wrapped(<TelegramSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1), { interval: 10 });
    vi.unstubAllGlobals();
  });

  it('a refusal with no message falls back to no response from the server', () => {
    registry.byUrl = { [TELEGRAM]: silentFailure(TG_STORED) };
    wrapped(<TelegramSettingsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.getByDisplayValue('987654321')).toBeTruthy();
  });

  it('carries the load failure on the banner and not on a fading toast', () => {
    registry.byUrl = { [TELEGRAM]: failedRead('Request failed (502)') };
    wrapped(<TelegramSettingsPage />);
    expect(alerts()).toContain('Failed to load Telegram settings');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/notifications/page.tsx',
    'app/tenant/settings/telegram/page.tsx',
  ];

  it('splits the two states apart on both pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`)
        .toMatch(/const failed = Boolean\(error\) && !data;/);
      expect(src, `${f} never learns what a kept payload is`)
        .toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
      expect(src, `${f} prints a raw error that can be undefined`)
        .toMatch(/error\?\.message \|\| 'no response from the server'/);
      expect(src, `${f} has no last-read caveat keyed off the stale branch`)
        .toMatch(/\{stale && \(/);
      expect(src, `${f} has no outage gate`).toMatch(/if \(failed\) \{/);
    }
  });

  it('leaves no gate keyed off the bare flag', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      // Anchored at the start of the line: these files quote the old gate in prose, and a
      // ratchet that matched the quotation would be red against the fixed page.
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/^\s*if \(error\)/m);
      expect(src, `${f} still branches the read on the bare flag`).not.toMatch(/\{\s*error\s*&&\s*\(/);
      expect(src, `${f} still renders an error ternary`).not.toMatch(/:\s*error\s*\?/);
      expect(src, `${f} still dashes on the bare flag`).not.toMatch(/\w*[Ee]rror \? '—'/);
    }
  });

  it('retired the toast as the page-state channel and kept it as action feedback', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts the read failure from the render body`)
        .not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still toasts a load failure, wherever it sits`)
        .not.toMatch(/toast\.error\((['"`])Failed to load.*?\1/);
      expect(src, `${f} stopped telling the operator what their own action did`)
        .toMatch(/toast\.success\(/);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // Both pages bind `error` and render InlineErrorState, so the sweep asks a question this
    // class cannot answer: it never asks whether the branch is reachable only when `data` is gone.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} has no split to rewind`).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
      expect(inspect(f, src).offends, `${f}: the fixed page offends the guard`).toBe(false);

      const rewound = src
        .replace(/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);/, 'const failed = Boolean(error);')
        .replace(/\{\s*stale && \([\s\S]*?\)\s*\}\n/, '')
        .replace(/if \(failed\) \{/g, 'if (error) {');
      expect(rewound, `${f}: the split changed shape, update this check`).not.toBe(src);
      expect(rewound, `${f}: the last-read caveat survived the rewind`).not.toMatch(/Could not refresh/);
      expect(inspect(f, rewound).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — it is `{}` on main, and every honest fix elsewhere keeps it so.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is already visible to the guard`).not.toContain(f);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});

describe('overlap hygiene with the #2829 suite (#2872)', () => {
  it('the settings 2829 suite never speaks about a kept read', () => {
    const src = readFileSync(
      join(process.cwd(), 'tests/unit/panel-page-error-not-empty-tenant-settings-2829.test.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/last read/);
  });
});
