// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/forms/public/[id]/page.tsx`: the form a customer fills in.
 *
 * One read, `useApiQuery(['forms','public',id], '/api/tenant/forms/public/${id}')` — so
 * `retry: 2` and `staleTime: 30_000` from `lib/query/client.tsx:47-58`, no `retry: false` to hide
 * behind. Two things were done with the flag, and neither of them was a state:
 *
 *   useEffect(() => { if (error) toast.error(error.message || 'Failed to load form'); }, [error]);
 *   …
 *   if (!form) return <h1>Form Not Found</h1><p>This form may have been deleted or is no longer active.</p>
 *
 * So every failure mode — the 404 the route means (`app/api/tenant/forms/public/[id]/route.ts:15`
 * for an id that is not an entity id, `:36` for a form that is gone or unpublished), the 500 at
 * `:53`, the 403 at `:38-43`, a fetch the visitor's own network refused, a refresh that came back
 * refused, and a 2xx whose body was empty — produced the same four-second toast and then the same
 * durable sentence: **that form has been deleted**. The toast is the epic's fade; the sentence is the
 * lie, and it is told to a stranger who cannot open dev tools and has no way to ask again.
 *
 * The 403 is the one that shows the page overruling a decision the route already made. #2119 gave
 * that route a status and a machine-readable code of its own, `TENANT_NOT_ACTIVE`, "so visitors get a
 * truthful message and support has a signal instead of a silent 404" — `route.ts:32-34`. The page
 * ignored both the status and the code and answered a *suspended workspace* with "may have been
 * deleted or is no longer active". A visitor on a paused trial was told the company destroyed the
 * form.
 *
 * Now four states, and the answers stay answers:
 *
 *  - **404** → "Form Not Found", the same words, **no alert and no retry** — retrying cannot
 *    resurrect a form the server says is gone.
 *  - **403 carrying `code: 'TENANT_NOT_ACTIVE'`** → the availability card the route was written for:
 *    the form is temporarily unavailable, the organization behind it is not active right now, and
 *    **the form has not been deleted**. Also no retry, for the same reason.
 *  - **stale** (the form is on screen and a refresh came back refused) → the form stays, the fields
 *    stay fillable and submitting stays possible — pinned below, because a half-filled form must
 *    never be thrown away — under one banner naming that the questions on screen are the last read's,
 *    which matters because the values are keyed by the field identities that response carried.
 *  - **failed** (nothing ever came) → the outage card with `Try again`, and **no `<form>`, no submit
 *    button and no field** on the screen: nobody fills in a form whose definition this session failed
 *    to read. A 403 with any *other* code, or no code at all, is this arm and not an answer, which is
 *    why the availability arm keys on the code rather than the status.
 *
 * The read's fading toast goes with the `useEffect` that carried it. `submitMutation.onError` keeps
 * its toast: that one is a write, it fires once per deliberate action, and the failure it reports is
 * already on screen in the form itself.
 *
 * RED AT BASE. Measured against the page as it stands on `origin/main` in a clean tree; the count is
 * in the PR body. The cases that pass at base are the controls — the answered 404, the clean render,
 * the submit that works, the thank-you message, the answered zero fields, the first-load spinner, the
 * write toast, the hygiene grep and the source pins that were already true.
 *
 * Fixtures are documentation-only (RFC 2606 .example names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'form-9' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenant/forms/public/form-9',
  useSearchParams: () => new URLSearchParams(),
}));

import toast from 'react-hot-toast';
import PublicFormPage from '@/app/tenant/forms/public/[id]/page';

const FORM_URL = '/api/tenant/forms/public/form-9';
const SUBMIT_URL = '/api/forms/submit';
const QUERY_KEY = ['forms', 'public'];

type Rule =
  | { json: unknown }
  | { status: number; body?: Record<string, unknown> }
  | { networkError: string }
  | { pending: true };

const net = {
  get: [] as Rule[],
  consumed: 0,
  post: { json: {} } as Rule,
  calls: [] as string[],
  bodies: [] as string[],
};

const FORM = {
  id: 'form-9',
  name: 'Enterprise demo request',
  description: 'Tell us what hurts and we will call you back.',
  fields: [
    { id: 'full_name', label: 'Full name', type: 'text', required: true },
    { id: 'company', label: 'Company', type: 'text' },
    { id: 'notes', label: 'What do you want to fix?', type: 'textarea' },
    { id: 'size', label: 'Team size', type: 'select', options: ['1-10', '11-50', '51+'] },
    { id: 'agree', label: 'I agree to be contacted', type: 'checkbox', required: true },
  ],
  settings: { success_message: 'Thanks — a human will be in touch.' },
};

const NOT_FOUND = { status: 404, body: { error: 'Not found' } } as Rule;
const TENANT_DOWN = {
  status: 403, body: { error: 'This form is temporarily unavailable', code: 'TENANT_NOT_ACTIVE' },
} as Rule;

function rule(r: Rule): Response {
  if ('pending' in r) return new Promise(() => undefined) as unknown as Response;
  if ('networkError' in r) throw new TypeError(r.networkError);
  if ('status' in r) {
    return { ok: false, status: r.status, json: async () => r.body ?? {} } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => r.json } as unknown as Response;
}

let client: QueryClient;

beforeEach(() => {
  // retry:false is only here to make the outage arm arrive in one step; production retries twice
  // and then arrives at the same place with no way back.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  net.get = [{ json: FORM }];
  net.consumed = 0;
  net.post = { json: {} };
  net.calls = [];
  net.bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    net.calls.push(`${method} ${url}`);
    if (method === 'POST') {
      if (typeof init?.body === 'string') net.bodies.push(init.body);
      return rule(net.post);
    }
    const i = Math.min(net.consumed, net.get.length - 1);
    net.consumed += 1;
    return rule(net.get[i]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.clear();
  vi.clearAllMocks();
});

function mountPage() {
  return render(
    <QueryClientProvider client={client}>
      <PublicFormPage />
    </QueryClientProvider>,
  );
}

const text = (view: ReturnType<typeof render>) => view.container.textContent ?? '';
const alerts = () => screen.queryAllByRole('alert');
const gets = () => net.calls.filter(c => c.startsWith('GET')).length;

async function mountLoaded() {
  const view = mountPage();
  await waitFor(() => expect(text(view)).toContain('Enterprise demo request'));
  return view;
}

/** The read answers, then a refresh of that very key is refused. */
async function refusedRefresh(status = 500, body: Record<string, unknown> = { error: 'Internal server error' }) {
  net.get = [{ json: FORM }, { status, body }, { json: FORM }];
  net.consumed = 0;
  const view = await mountLoaded();
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
  await waitFor(() => expect(gets()).toBe(2));
  return view;
}

const fill = (view: ReturnType<typeof render>) => {
  const inputs = view.container.querySelectorAll('input[type="text"]');
  fireEvent.change(inputs[0], { target: { value: 'Ada Byron' } });
  fireEvent.change(view.container.querySelector('textarea')!, { target: { value: 'Twelve spreadsheets.' } });
  // React routes a checkbox's onChange through the click event, so a change event never reaches
  // updateValue; clicking is what a visitor's finger does.
  fireEvent.click(view.container.querySelector('input[type="checkbox"]')!);
};

describe('the public form page — a refresh that was refused keeps the form', () => {
  it('keeps every question the visitor was answering', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s).toContain('Enterprise demo request');
    expect(s).toContain('Tell us what hurts and we will call you back.');
    for (const label of ['Full name', 'Company', 'What do you want to fix?', 'Team size', 'I agree to be contacted']) {
      expect(s, `a refused refresh lost the "${label}" question`).toContain(label);
    }
  });

  it('raises exactly one alert that says which questions are the last read', async () => {
    await refusedRefresh();
    expect(alerts()).toHaveLength(1);
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toMatch(/last read/i);
    expect(banner, 'the banner must name the questions').toMatch(/question|field/i);
  });

  it('never claims the form was deleted while it is on the screen', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s, 'a stale read may not pronounce the form deleted').not.toMatch(/deleted/i);
    expect(s).not.toMatch(/no longer active/i);
    expect(s).not.toMatch(/not found/i);
  });

  it('a visitor mid-answer can still submit over the stale read', async () => {
    const view = await refusedRefresh();
    fill(view);
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(net.calls).toContain(`POST ${SUBMIT_URL}`));
    expect(net.bodies[0]).toContain('"form_id":"form-9"');
    expect(net.bodies[0]).toContain('Ada Byron');
    expect(net.bodies[0]).toContain('Twelve spreadsheets.');
  });

  it('keeps the required marks the last read carried', async () => {
    const view = await refusedRefresh();
    const required = Array.from(view.container.querySelectorAll('[required]'));
    expect(required.length).toBe(2);
  });

  it("the banner's Try again re-reads, and the caveat leaves when the read answers", async () => {
    const view = await refusedRefresh(502, { error: 'Bad gateway' });
    expect(alerts()).toHaveLength(1);
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(gets()).toBe(3));
    await waitFor(() => expect(alerts()).toHaveLength(0));
    expect(text(view)).toContain('Enterprise demo request');
  });

  it('a submission that succeeded over the stale read ends on the thank-you card, not the caveat', async () => {
    const view = await refusedRefresh();
    fill(view);
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(text(view)).toContain('Thanks — a human will be in touch.'));
    expect(alerts(), 'a recorded answer must not still be told the read is behind').toHaveLength(0);
  });
});

describe('the public form page — a read that never answered', () => {
  it('a 500 is an outage with a way back, and no form to fill', async () => {
    net.get = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    const s = text(view);
    expect(s).toContain('Try again');
    expect(s).not.toMatch(/deleted|no longer active|not found/i);
    expect(view.container.querySelector('form')).toBeNull();
    expect(view.container.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(s).not.toContain('Submit');
  });

  it('the outage speaks in the reason, and the read never reaches the fading toast', async () => {
    net.get = [{ status: 500, body: { error: 'Internal server error' } }];
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Request failed (500)');
    expect(toast.error, 'a failed read must not be a four-second toast').not.toHaveBeenCalled();
  });

  it('a fetch the visitor refused is an outage, and Try again recovers', async () => {
    net.get = [{ networkError: 'Failed to fetch' }, { json: FORM }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('Enterprise demo request'));
    expect(alerts()).toHaveLength(0);
  });

  it('an answered 2xx with an empty body is an outage, not a verdict on the form', async () => {
    net.get = [{ json: null }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(text(view)).not.toMatch(/deleted|no longer active|not found/i);
    expect(view.container.querySelector('form')).toBeNull();
  });

  it('a 403 that is not the availability code is an outage, not an answer', async () => {
    net.get = [{ status: 403, body: { error: 'Forbidden' } }, { json: FORM }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('Enterprise demo request'));
  });

  it('a read that never answered still gets no submit affordance, so nothing is posted', async () => {
    net.get = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(net.calls.filter(c => c.startsWith('POST'))).toHaveLength(0);
    expect(view.container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('the outage leaves the visitor on the page, not somewhere else', async () => {
    net.get = [{ status: 500, body: {} }];
    const before = window.location.href;
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
  });
});

describe('the public form page — reads that answered stay answers', () => {
  it('a 404 is "Form Not Found", with no alert and no retry', async () => {
    net.get = [NOT_FOUND];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toContain('Form Not Found'));
    expect(text(view)).toContain('no longer active');
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('the 403 #2119 wrote for a paused workspace says unavailable, not deleted', async () => {
    net.get = [TENANT_DOWN];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toMatch(/temporarily unavailable/i));
    const s = text(view);
    expect(s, 'a suspended tenant must not be reported as a deleted form').not.toMatch(/deleted/i);
    expect(s).not.toMatch(/no longer active/i);
    expect(alerts(), 'the server answered this, so it is not a failure state').toHaveLength(0);
    expect(view.container.querySelector('form')).toBeNull();
  });

  it('a clean read renders the form and says nothing about freshness', async () => {
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    expect(text(view)).toContain('Enterprise demo request');
    expect(view.container.querySelector('form')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    expect(gets()).toBe(1);
    expect(net.calls).toContain(`GET ${FORM_URL}`);
  });

  it('a form with no fields is an answered zero, not an outage', async () => {
    net.get = [{ json: { ...FORM, fields: [] } }];
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    expect(view.container.querySelector('form')).toBeTruthy();
    expect(text(view)).toContain('Submit');
  });

  it('submitting a clean read posts the field identities the read carried', async () => {
    const view = await mountLoaded();
    fill(view);
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(net.calls).toContain(`POST ${SUBMIT_URL}`));
    expect(net.bodies[0]).toContain('"full_name":"Ada Byron"');
    expect(net.bodies[0]).toContain('"notes":"Twelve spreadsheets."');
    expect(net.bodies[0]).toContain('"agree":true');
  });

  it('a submit that the server refused still reports through the write toast', async () => {
    net.post = { status: 400, body: { error: 'Company is required' } };
    const view = await mountLoaded();
    fill(view);
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Company is required'));
    expect(alerts(), 'a write failure is not a read failure').toHaveLength(0);
  });

  it('the thank-you card shows the form’s own success message', async () => {
    const view = await mountLoaded();
    fill(view);
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(text(view)).toContain('Thanks — a human will be in touch.'));
  });

  it('the first load is the spinner, not an outage card and not a blank page', async () => {
    net.get = [{ pending: true }];
    const view = mountPage();
    await waitFor(() => expect(view.container.querySelector('.animate-spin')).toBeTruthy());
    expect(text(view)).toContain('Loading form...');
    expect(alerts()).toHaveLength(0);
  });

  it('this page is mounted by no other suite', () => {
    const hits = spawnSync('grep', ['-rlF', 'forms/public/[id]/page', 'tests/unit'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-forms-public-page-stale-2872.test.tsx',
    ]);
  });
});

describe('the public form page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/tenant/forms/public/[id]/page.tsx'), 'utf8');

  it('the read no longer speaks through the fading toast', () => {
    expect(src).not.toMatch(/useEffect\(\(\) => \{\s*if \(error\)/);
    expect(src).not.toMatch(/toast\.error\(error\.message/);
    expect(src).not.toMatch(/useEffect/);
  });

  it('no branch of the render is gated on the record alone', () => {
    expect(src).not.toMatch(/if \(!form\) \{\n\s*return \(\n\s*<div className="min-h-screen flex items-center justify-center">\n\s*<div className="text-center space-y-4 max-w-md/);
  });

  it('a refused refresh is derived, in the house shape', () => {
    expect(src).toMatch(/Boolean\(error\)\s*&&\s*Boolean\(form\)/);
    expect(src).toMatch(/error\?\.message \|\| 'no response from the server'/);
  });

  it('the answered arms only answer when nothing is on screen', () => {
    const line = src.split('\n').find(l => l.includes('=== 404')) ?? '';
    expect(line, 'the 404 arm must be reachable only without a record').toMatch(/!form|failed/);
  });

  it('the availability arm keys on the code #2119 minted, not on the bare status', () => {
    expect(src).toMatch(/errorCode\s*===\s*'TENANT_NOT_ACTIVE'/);
    expect(src).toMatch(/=== 403/);
    const line = src.split('\n').find(l => l.includes('TENANT_NOT_ACTIVE')) ?? '';
    expect(line, 'the availability arm must be reachable only without a record').toMatch(/!form|failed/);
  });

  it('uses the shared banner twice and never a hand-rolled alert', () => {
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
    expect((src.match(/onRetry=\{refetch\}/g) ?? []).length).toBe(2);
  });

  it('the outage copy and the stale copy both interpolate the reason', () => {
    expect(src).toMatch(/\$\{reason\}/);
    expect(src).not.toMatch(/String\(error\)|error\.stack|\{error\}/);
  });

  it('the form is still gated on the record, not on freshness', () => {
    expect(src).not.toMatch(/!stale && \(/);
    expect(src).toMatch(/form\.fields\?\.map/);
  });

  it('the stale banner sits above the form it qualifies and off the thank-you card', () => {
    const banner = src.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(src.indexOf('{/* Form */}')).toBeGreaterThan(banner);
    expect(src.indexOf('if (submitted)'), 'a recorded answer returns before any caveat').toBeLessThan(banner);
  });

  it('the read keeps its retry budget and gains no background refresh', () => {
    expect(src).not.toMatch(/retry: false|refetchOnWindowFocus|invalidateQueries|location\.reload|location\.assign|setInterval/);
  });

  it('nothing navigates away from a failed read', () => {
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
  });

  it('this page is read by exactly one query', () => {
    expect((src.match(/useApiQuery</g) ?? []).length).toBe(1);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
