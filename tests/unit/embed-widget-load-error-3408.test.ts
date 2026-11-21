/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3408 — the embed widget used to hand every fetch response straight to
 * renderForm, so a 404/500 with `{error: "..."}` became an empty form with a
 * Submit button: a failed load was indistinguishable from an empty result.
 * These tests execute the served (minified) artifact against jsdom and assert
 * on the DOM, the same way tests/unit/embed-widget-field-id-escaping-3296.test.ts
 * does — a string assertion on the source would not prove the widget behaves.
 */
import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

import * as embedRoute from '@/app/api/embed/form.js/route';

const SCRIPT_SRC = 'https://crm.invalid/api/embed/form.js?id=FORM_1';
const TARGET_ID = 'nucrm-form';

/** Run the real served widget with one stubbed form-fetch response. */
async function runWidget(response: { ok: boolean; status: number; body: unknown }): Promise<HTMLElement> {
  const js = await (await embedRoute.GET()).text();
  const dom = new JSDOM(`<!doctype html><html><body><div id="${TARGET_ID}"></div></body></html>`, {
    url: 'https://customer-site.invalid/',
  });
  const { window } = dom;
  const script = window.document.createElement('script');
  script.src = SCRIPT_SRC;
  Object.defineProperty(window.document, 'currentScript', { value: script, configurable: true });

  const fetchStub = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }));
  runInNewContext(js, {
    document: window.document,
    fetch: fetchStub,
    URLSearchParams: window.URLSearchParams,
    console: window.console,
  });
  // Promise chains plus the outer .catch need a couple of microtask turns.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const container = window.document.getElementById(TARGET_ID);
  if (!container) throw new Error('widget removed its container');
  return container as HTMLElement;
}

describe('#3408: embed widget load failures are not rendered as an empty form', () => {
  it.each([
    ['404 missing/unpublished form', 404, { error: 'Not found' }, 'Not found'],
    ['403 suspended tenant', 403, { error: 'This form is temporarily unavailable', code: 'TENANT_NOT_ACTIVE' },
      'This form is temporarily unavailable'],
    ['500 server error', 500, { error: 'Internal server error' }, 'Internal server error'],
  ])('%s shows the server message and no form', async (_label, status, body, message) => {
    const container = await runWidget({ ok: false, status, body });
    expect(container.textContent).toContain(message);
    expect(container.querySelector('#nucrm-embed-form')).toBeNull();
    expect(container.querySelector('#nucrm-submit-btn')).toBeNull();
  });

  it('a non-JSON error body still shows an explicit failure, not an empty form', async () => {
    const container = await runWidget({ ok: false, status: 503, body: undefined });
    expect(container.textContent).toContain('Failed to load form (HTTP 503)');
    expect(container.querySelector('#nucrm-embed-form')).toBeNull();
  });

  it('a failure envelope inside a 200 is caught too', async () => {
    const container = await runWidget({ ok: true, status: 200, body: { error: 'Form unavailable' } });
    expect(container.textContent).toContain('Form unavailable');
    expect(container.querySelector('#nucrm-embed-form')).toBeNull();
  });

  it('a valid form still renders — the fix must not gate the happy path', async () => {
    const container = await runWidget({
      ok: true,
      status: 200,
      body: { id: 'FORM_1', name: 'Demo', fields: [{ id: 'email', label: 'Email', type: 'text' }] },
    });
    expect(container.querySelector('#nucrm-embed-form')).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Failed to load form');
  });

  it('the canonical { ok:false, error:{ code, message } } load failure shows its message', async () => {
    // #3408 PR-5B compat: the widget must keep working when the API moves from
    // a bare error string to the one canonical envelope.
    const container = await runWidget({
      ok: true,
      status: 200,
      body: { ok: false, error: { code: 'FORM_UNAVAILABLE', message: 'Form is unavailable right now' } },
    });
    expect(container.textContent).toContain('Form is unavailable right now');
    expect(container.querySelector('#nucrm-embed-form')).toBeNull();
  });
});

type Reply = { ok: boolean; status: number; body: unknown };

/** Run the real widget with a rendered form and one stubbed submit response. */
async function runSubmit(reply: Reply): Promise<HTMLElement> {
  const js = await (await embedRoute.GET()).text();
  const dom = new JSDOM(`<!doctype html><html><body><div id="${TARGET_ID}"></div></body></html>`, {
    url: 'https://customer-site.invalid/',
  });
  const { window } = dom;
  const script = window.document.createElement('script');
  script.src = SCRIPT_SRC;
  Object.defineProperty(window.document, 'currentScript', { value: script, configurable: true });

  const fetchStub = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.indexOf('/api/forms/submit') !== -1) {
      return { ok: reply.ok, status: reply.status, json: async () => reply.body };
    }
    if (url.indexOf('/analytics') !== -1) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'FORM_1', name: 'Demo', fields: [{ id: 'email', label: 'Email', type: 'text' }] }),
    };
  });
  runInNewContext(js, {
    document: window.document,
    fetch: fetchStub,
    URLSearchParams: window.URLSearchParams,
    console: window.console,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const form = window.document.getElementById('nucrm-embed-form');
  if (!form) throw new Error('widget did not render a form');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const errorDiv = window.document.getElementById('nucrm-form-error');
  if (!errorDiv) throw new Error('widget has no error container');
  return errorDiv as HTMLElement;
}

describe('#3408: embed widget submit failures surface a message, not [object Object]', () => {
  it('the canonical failure envelope shows the server message', async () => {
    const errorDiv = await runSubmit({
      ok: true,
      status: 200,
      body: { ok: false, error: { code: 'FORM_CLOSED', message: 'This form has closed' } },
    });
    expect(errorDiv.style.display).toBe('block');
    expect(errorDiv.textContent).toContain('This form has closed');
    expect(errorDiv.textContent).not.toContain('[object Object]');
  });

  it('the legacy bare error string still works', async () => {
    const errorDiv = await runSubmit({ ok: false, status: 400, body: { error: 'Invalid form id' } });
    expect(errorDiv.textContent).toContain('Invalid form id');
  });

  it('a successful submit still shows the success state', async () => {
    const errorDiv = await runSubmit({ ok: true, status: 200, body: { ok: true, message: 'Thanks!' } });
    expect(errorDiv.style.display).toBe('none');
  });
});
