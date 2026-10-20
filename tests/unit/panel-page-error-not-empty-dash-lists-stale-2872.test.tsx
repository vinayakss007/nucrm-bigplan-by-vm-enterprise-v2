// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — three list pages whose counters are computed from the rows on screen:
 * `app/tenant/sms/page.tsx` (message read), `app/tenant/email-templates/page.tsx`,
 * and `app/tenant/settings/ai-templates/page.tsx`.
 *
 * Each of these pages had the same shape once #2829 landed: the error was bound, the
 * derived numbers refused to count an unread list, and a banner with a retry replaced
 * the list. That is right for a read that never answered. TanStack Query keeps `data`
 * when a *revalidation* of a read that already succeeded fails, so the same branch also
 * fired for "answered, then refused" — and in that state the page is looking at the rows
 * and dashes the numbers it counted off them, then hides the rows behind an outage card
 * that tells the operator to go and re-do the thing they just did.
 *
 * The trigger is ordinary here, not exotic: `sendSms.onSuccess` invalidates
 * `['tenant','sms']` (prefix, so it also reloads the template picker), save/delete/
 * duplicate on email-templates all call `reload()`, and all three mutations on
 * ai-templates invalidate. Installing a template and having its reload refused is the
 * common path, and it was the broken one.
 *
 * ai-templates had a second defect: the read's message was folded into the same `error`
 * the mutations feed (`(queryError as Error | null)?.message ?? install.error?.message
 * ?? …`). A refused revalidation of a list the page was still showing therefore announced
 * "Failed to update templates", and because `??` passes an empty string through, an
 * `Error` with no message silenced the banner outright.
 *
 * `scripts/check-panel-error-state.mjs` cannot see any of this — it asks whether the file
 * binds an error and renders a banner, which all three files did before this slice. The
 * anti-vacuity case rewinds two of these three pages and the guard still reports them
 * clean, which is the proof that these assertions, not the sweep, are what hold the fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
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
import EmailTemplatesPage from '@/app/tenant/email-templates/page';
import AITemplatesPage from '@/app/tenant/settings/ai-templates/page';

// `filter` starts at 'all', so the page asks for an empty query string — the trailing
// '?' is part of the key it actually reads.
const SMS = '/api/tenant/sms?';
const SMS_DELIVERED = '/api/tenant/sms?status=delivered';
const SMS_TEMPLATES = '/api/tenant/sms/templates';
const EMAIL = '/api/tenant/email-templates';
const AI = '/api/tenant/admin/ai-templates';

const NOW = '2026-03-04T10:00:00.000Z';
const messageRows = {
  data: [
    { id: 'm1', to: '+15550001111', from: null, body: 'Delivery window moved to Friday', direction: 'outbound', status: 'delivered', templateId: null, createdAt: NOW },
    { id: 'm2', to: '+15550002222', from: null, body: 'Code 4821', direction: 'outbound', status: 'failed', templateId: null, createdAt: NOW },
    { id: 'm3', to: '+15550003333', from: null, body: 'Site visit confirmed', direction: 'outbound', status: 'sent', templateId: null, createdAt: NOW },
    { id: 'm4', to: '+15550004444', from: null, body: 'Invoice ready', direction: 'outbound', status: 'delivered', templateId: null, createdAt: NOW },
  ],
};
const smsTemplateRows = { data: [{ id: 't1', name: 'Delivery notice', body: 'Your delivery is on its way', variables: [] }] };

const emailRows = {
  data: [
    { id: 'e1', name: 'Intro call', subject: 'When works?', body: 'Hi {{name}}, are you free Tuesday?', category: 'Follow-up', created_at: NOW, updated_at: NOW },
    { id: 'e2', name: 'Welcome pack', subject: 'Getting started', body: 'Here is everything you need.', category: 'Onboarding', created_at: NOW, updated_at: NOW },
  ],
};

const aiResp = {
  templates: [
    { id: 'a1', slug: 'weekly-digest', name: 'Weekly digest', description: 'Summarises the week', kind: 'email', systemPrompt: 's', userPrompt: 'u', tone: 'professional', active: true },
    { id: 'a2', slug: 'objection-reply', name: 'Objection reply', description: null, kind: 'reply', systemPrompt: 's', userPrompt: 'u', tone: 'warm', active: true },
  ],
  seeds: [
    { id: null, slug: 'starter-note', name: 'Call summary starter', description: null, kind: 'note', systemPrompt: 's', userPrompt: 'u', tone: 'concise', active: true, seed: true },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not — the state the old single flag could not express. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** The four SMS cards count `messages`, so their labels are the thing under test. */
const smsCardValue = (label: string): string => {
  const found = [...document.querySelectorAll('p')].filter(
    (el) => el.textContent === label && el.className.includes('text-xs') && el.className.includes('font-medium'),
  );
  expect(found.length, `expected one "${label}" stat label, saw ${found.length}`).toBe(1);
  const value = found[0].parentElement?.querySelector('p[class*="text-2xl"]');
  expect(value, `the "${label}" card lost its number`).not.toBeNull();
  return value!.textContent ?? '';
};
const headerCount = () => screen.getByText(/^Your templates \(/).textContent ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** Rejects every mutation while leaving the reads to the registry. */
const refusedWrite = (message: string) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 500, json: async () => ({ error: message }),
  } as Response));
/** The mutation's own rejection reaches the page one tick after the click resolves. */
const settledWith = (copy: RegExp) =>
  waitFor(() => expect(alerts()).toMatch(copy), { interval: 10 });

describe('sms: a refused refresh keeps the log and the numbers counted off it (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the four counters counting and the rows on screen', () => {
    registry.byUrl = { [SMS]: staleRead(messageRows), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    expect(smsCardValue('Total Messages')).toBe('4');
    expect(smsCardValue('Sent')).toBe('1');
    expect(smsCardValue('Delivered')).toBe('2');
    expect(smsCardValue('Failed')).toBe('1');
    expect(screen.getByText('Delivery window moved to Friday')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('does not call a refused refresh an empty inbox', () => {
    registry.byUrl = { [SMS]: staleRead(messageRows), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    // "No messages found / Send your first SMS" is the invitation to re-send a campaign
    // that is sitting in the table behind it.
    expect(screen.queryByText('No messages found')).toBeNull();
    expect(screen.queryByText(/Send your first SMS/)).toBeNull();
    expect(alerts()).not.toMatch(/Failed to load the message log/);
  });

  it('dashes every card and shows the outage for a read that never answered', () => {
    registry.byUrl = { [SMS]: failed('Request failed (503)'), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    for (const label of ['Total Messages', 'Sent', 'Delivered', 'Failed']) {
      expect(smsCardValue(label)).toBe('—');
    }
    expect(alerts()).toMatch(/Failed to load the message log: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/);
  });

  it('prints the real zeros and the empty copy when empty is what the read answered', () => {
    registry.byUrl = { [SMS]: ok({ data: [] }), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    expect(smsCardValue('Total Messages')).toBe('0');
    expect(screen.getByText('No messages found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('treats a status view that has never answered as a failure, not a stale read', () => {
    // `filter` is in the query key, so switching to Delivered is a brand-new read.
    registry.byUrl = { [SMS]: ok(messageRows), [SMS_DELIVERED]: failed('Request failed (502)'), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delivered' }));
    expect(smsCardValue('Total Messages')).toBe('—');
    expect(alerts()).toMatch(/Failed to load the message log: Request failed \(502\)/);
    expect(alerts()).not.toMatch(/last read/);
  });

  it('re-runs the message read from the caveat, not the template read beside it', () => {
    registry.byUrl = { [SMS]: staleRead(messageRows), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SMS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[SMS_TEMPLATES].refetch).not.toHaveBeenCalled();
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [SMS]: staleRead(messageRows, ''), [SMS_TEMPLATES]: ok(smsTemplateRows) };
    wrapped(<SmsPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Delivery window moved to Friday')).toBeTruthy();
  });
});

describe('email-templates: a refused reload after a save keeps the grid it just wrote to (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the header count real and the cards it read', () => {
    registry.byUrl = { [EMAIL]: staleRead(emailRows) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('2 templates')).toBeTruthy();
    expect(screen.getByText('Intro call')).toBeTruthy();
    expect(screen.getByText('Welcome pack')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('keeps the category chips derived from the templates it can still show', () => {
    registry.byUrl = { [EMAIL]: staleRead(emailRows) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByRole('button', { name: 'Follow-up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Onboarding' })).toBeTruthy();
    expect(screen.queryByText('No templates yet')).toBeNull();
  });

  it('dashes the count and replaces the grid for a read that never answered', () => {
    registry.byUrl = { [EMAIL]: failed('Request failed (503)') };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('Intro call')).toBeNull();
    expect(alerts()).toMatch(/Failed to load your email templates: Request failed \(503\)/);
    expect(screen.queryByText('No templates yet')).toBeNull();
  });

  it('says none are saved, with a real zero and no alert, when that is what came back', () => {
    registry.byUrl = { [EMAIL]: ok({ data: [] }) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('0 templates')).toBeTruthy();
    expect(screen.getByText('No templates yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none are saved when the empty list is all the last read has', () => {
    registry.byUrl = { [EMAIL]: staleRead({ data: [] }) };
    wrapped(<EmailTemplatesPage />);
    expect(screen.getByText('0 templates')).toBeTruthy();
    expect(screen.getByText('No templates yet')).toBeTruthy();
    // The caveat is the difference between "none exist" and "I could not check".
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('settings/ai-templates: the read is no longer reported as a write (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps "Your templates (2)" and both cards when the reload after a save is refused', () => {
    registry.byUrl = { [AI]: staleRead(aiResp) };
    wrapped(<AITemplatesPage />);
    expect(headerCount()).toBe('Your templates (2)');
    expect(screen.getByText('Weekly digest')).toBeTruthy();
    expect(screen.getByText('Objection reply')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(screen.getByText(/Starter library/)).toBeTruthy();
  });

  it('separates a failed write from a failed read when both refuse at once', async () => {
    refusedWrite('That slug is already taken');
    registry.byUrl = { [AI]: staleRead(aiResp, 'Could not reload the library') };
    wrapped(<AITemplatesPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    });
    await settledWith(/Failed to update templates: That slug is already taken/);
    expect(alerts()).toMatch(/last read/i);
    // Folding the read into the mutation chain reported the write as the outage instead.
    expect(alerts()).not.toMatch(/Failed to load AI templates/);
    expect(screen.getByText('Weekly digest')).toBeTruthy();
  });

  it('refuses to go silent when a messageless error follows a list it still shows', () => {
    registry.byUrl = { [AI]: staleRead(aiResp, '') };
    wrapped(<AITemplatesPage />);
    expect(alerts(), 'the old `?? ` chain let an empty message silence the banner').toMatch(/no response from the server/);
    expect(screen.getByText('Weekly digest')).toBeTruthy();
  });

  it('banners a messageless failure for a list that never answered', () => {
    registry.byUrl = { [AI]: failed('') };
    wrapped(<AITemplatesPage />);
    expect(alerts()).toMatch(/Failed to load AI templates: no response from the server/);
    expect(headerCount()).toBe('Your templates (—)');
  });

  it('dashes the header and shows the outage for a read that never answered', () => {
    registry.byUrl = { [AI]: failed('Request failed (503)') };
    wrapped(<AITemplatesPage />);
    expect(headerCount()).toBe('Your templates (—)');
    expect(screen.queryByText('Weekly digest')).toBeNull();
    expect(alerts()).toMatch(/Failed to load AI templates: Request failed \(503\)/);
    expect(screen.queryByText(/No saved templates yet/)).toBeNull();
  });

  it('says none are saved, with a real zero and no alert, when that is what came back', () => {
    registry.byUrl = { [AI]: ok({ templates: [], seeds: aiResp.seeds }) };
    wrapped(<AITemplatesPage />);
    expect(headerCount()).toBe('Your templates (0)');
    expect(screen.getByText(/No saved templates yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('keeps the mutation copy for a plain failed write, which is what it always meant', async () => {
    refusedWrite('Prompt is required');
    registry.byUrl = { [AI]: ok(aiResp) };
    wrapped(<AITemplatesPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    });
    await settledWith(/Failed to update templates: Prompt is required/);
    expect(alerts()).not.toMatch(/last read/);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/sms/page.tsx',
    'app/tenant/email-templates/page.tsx',
    'app/tenant/settings/ai-templates/page.tsx',
  ];
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the two states on every page instead of branching on one flag', () => {
    expect(src(FILES[0])).toMatch(/Boolean\(messagesError\) && !messagesData/);
    expect(src(FILES[0])).toMatch(/Boolean\(messagesError\) && Boolean\(messagesData\)/);
    expect(src(FILES[1])).toMatch(/Boolean\(error\) && !data/);
    expect(src(FILES[1])).toMatch(/Boolean\(error\) && Boolean\(data\)/);
    expect(src(FILES[2])).toMatch(/Boolean\(queryError\) && !data/);
    expect(src(FILES[2])).toMatch(/Boolean\(queryError\) && Boolean\(data\)/);
    for (const f of FILES) {
      expect(src(f)).toMatch(/'\{[A-Za-z]*[Rr]eason\}'|no response from the server/);
    }
  });

  it('never dashes a derived number on the bare flag', () => {
    for (const f of FILES) {
      expect(src(f), `${f} still punishes a kept read`).not.toMatch(/\w*[Ee]rror \? '—'/);
      expect(src(f), `${f} still banners on the flag alone`).not.toMatch(/\)\s*:\s*(?:\w*[Ee]rror|error) \? \(/);
      expect(src(f)).toMatch(/\{(?:\w*[Ss]tale|stale) && \(/);
    }
  });

  it('keeps the ai-templates read out of the mutation-error chain', () => {
    const s = src(FILES[2]);
    expect(s, 'the fold that made a refused read sound like a refused write').not.toMatch(
      /const error =\s*\n?\s*\(queryError as Error \| null\)\?\.message \?\?/,
    );
    expect(s).toMatch(/const mutationError =/);
    expect(s).not.toMatch(/message=\{queryError/);
  });

  it('reports every page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string, string][] = [
      [FILES[0],
        /const messagesFailed = Boolean\(messagesError\) && !messagesData;\s*\n\s*const messagesStale = Boolean\(messagesError\) && Boolean\(messagesData\);/,
        'const messagesFailed = Boolean(messagesError);'],
      [FILES[1],
        /const stale = Boolean\(error\) && Boolean\(data\);/,
        'const stale = false;'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `${file}: the shape this slice depends on moved`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `${file}: the guard would catch this rewind after all`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    for (const f of FILES) expect(files, `${f} went back on the list`).not.toContain(f);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    for (const f of FILES) {
      expect(src(f).split('\n').length, `${f} is past the ceiling`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
