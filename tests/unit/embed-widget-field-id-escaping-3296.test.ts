/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3296 — the widget string builder escapes `name`, `label` and `placeholder` but interpolates the
 * field identity raw into `id="…"` and `for="…"`. A tenant-controlled field id therefore ends the
 * attribute and adds whatever it likes to a live element, and the payload is delivered to *customer
 * websites* that embed the script — not merely to the tenant's own panel.
 *
 * These tests execute the served widget against a jsdom document and assert on the DOM it actually
 * produces, because the defect is an HTML-parsing outcome, not a string: `bad"><img src=x onerror=…`
 * is only dangerous once the parser has read the first `"` as the attribute terminator.
 */
import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

import * as embedRoute from '@/app/api/embed/form.js/route';
import { createFormSchema, updateFormSchema } from '@/lib/api/schemas';

const SCRIPT_SRC = 'https://crm.invalid/api/embed/form.js?id=FORM_1';
const TARGET_ID = 'nucrm-form';

/** Render one form definition through the real served widget and return the container it filled. */
async function render(def: unknown): Promise<HTMLElement> {
  const js = await (await embedRoute.GET()).text();
  const dom = new JSDOM(`<!doctype html><html><body><div id="${TARGET_ID}"></div></body></html>`, {
    url: 'https://customer-site.invalid/',
  });
  const { window } = dom;
  const script = window.document.createElement('script');
  script.src = SCRIPT_SRC;
  Object.defineProperty(window.document, 'currentScript', { value: script, configurable: true });

  const fetchStub = vi.fn(async () => ({ json: async () => def }));
  // The widget reads nothing but these globals, so running the served artifact untouched in a throwaway
  // realm tests the artifact itself — minified build and all — instead of a paraphrase of it.
  runInNewContext(js, {
    document: window.document,
    fetch: fetchStub,
    URLSearchParams: window.URLSearchParams,
    console: window.console,
  });
  await new Promise((resolve) => setTimeout(resolve, 0)); // renderForm runs in a promise callback

  const container = window.document.getElementById(TARGET_ID);
  if (!container) throw new Error('widget removed its container');
  return container as HTMLElement;
}

const form = (id: string, type = 'text') => ({
  name: 'Demo',
  fields: [{ id, label: 'Your detail', type, required: false }],
});

describe('#3296: the embed widget escapes the field identity in id= and for=', () => {
  it('an id that terminates the attribute adds no event handler', async () => {
    const container = await render(form('a" onmouseover="pwned()'));
    expect(container.querySelector('[onmouseover]')).toBeNull();
  });

  it("the issue's own payload — onfocus plus a stray tabindex — yields neither", async () => {
    const container = await render(form('x" onfocus="alert(document.domain)" tabindex="0', 'textarea'));
    expect(container.querySelector('[onfocus]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
  });

  it('an id that closes the tag cannot inject an element', async () => {
    const container = await render(form('bad"><img src=x onerror=pwned()>'));
    expect(container.querySelector('img')).toBeNull();
  });

  it('a select and a checkbox escape it too, not only the text input', async () => {
    const select = await render({
      name: 'Demo',
      fields: [{ id: 's" onchange="pwned()', label: 'Pick', type: 'select', options: ['a', 'b'] }],
    });
    expect(select.querySelector('[onchange]')).toBeNull();
    const checkbox = await render(form('c" onclick="pwned()', 'checkbox'));
    expect(checkbox.querySelector('[onclick]')).toBeNull();
  });

  it('the label still points at its input once the id is escaped', async () => {
    const container = await render(form('a&b'));
    const label = container.querySelector('label[for]');
    const input = container.querySelector('input, textarea, select');
    // Escaping must not break the pairing: both attributes are escaped the same way, so the parsed
    // values stay equal, and `&` survives the round trip as the literal character.
    expect(label?.getAttribute('for')).toBe('nucrm-a&b');
    expect(input?.getAttribute('id')).toBe('nucrm-a&b');
  });

  it('the name attribute keeps the field identity, so #2287 submission keying is unchanged', async () => {
    const container = await render(form('email_1'));
    expect(container.querySelector('input')?.getAttribute('name')).toBe('email_1');
    expect(container.querySelector('input')?.getAttribute('id')).toBe('nucrm-email_1');
  });

  it('the container ends up holding only the elements the widget means to emit', async () => {
    const container = await render(form('q" autofocus="autofocus" onfocus=pwned()'));
    const allowed = new Set(['FORM', 'H2', 'P', 'DIV', 'LABEL', 'SPAN', 'INPUT', 'TEXTAREA',
      'SELECT', 'OPTION', 'BUTTON', 'SVG', 'PATH']);
    const rogue = [...container.querySelectorAll('*')].filter((el) => !allowed.has(el.tagName));
    expect(rogue.map((el) => el.outerHTML)).toEqual([]);
    for (const el of container.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        // Every event-handler and focus-trapping attribute here would be one the payload asked for.
        expect(attr.name.toLowerCase().startsWith('on'), `${attr.name} on ${el.tagName}`).toBe(false);
      }
    }
  });
});

describe('#3296: the field id is constrained at the boundary, not trusted from the writer', () => {
  const payload = (id: string) => ({
    name: 'Demo',
    fields: [{ id, label: 'X', type: 'text' }],
  });

  it.each([
    ['attribute terminator', 'a" onmouseover="pwned()'],
    ['tag closer', 'bad"><img src=x>'],
    ['whitespace', 'my field'],
    ['over the length cap', 'f'.repeat(65)],
    ['empty', ''],
  ])('createFormSchema rejects an id carrying %s', (_label, id) => {
    expect(createFormSchema.safeParse(payload(id)).success).toBe(false);
  });

  it.each(['email', 'phone_2', 'MY-field', 'field_1700000000000', 'a'])('and accepts the id %s', (id) => {
    expect(createFormSchema.safeParse(payload(id)).success).toBe(true);
  });

  it('PATCH takes the same rule as POST, so an existing form cannot be re-armed', () => {
    expect(updateFormSchema.safeParse(payload('a" onclick="pwned()')).success).toBe(false);
    expect(updateFormSchema.safeParse(payload('email')).success).toBe(true);
  });
});
