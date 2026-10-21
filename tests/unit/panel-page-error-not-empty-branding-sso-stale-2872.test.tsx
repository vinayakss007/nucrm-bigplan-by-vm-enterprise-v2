// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two settings forms that read their own configuration and said nothing when
 * the read did not answer: `app/tenant/settings/branding/page.tsx` and
 * `app/tenant/settings/sso/page.tsx`.
 *
 * The epic's premise is the toast-only panel (`if (error) toast.error(...)`, then a list
 * that keeps talking). Neither page is that panel, and the truth is worse: both destructured
 *
 *     const { data, isLoading: loading } = useApiQuery(…)
 *
 * so `error` was never bound, `refetch` was never taken, and there was no toast to remove.
 * The failure had no channel at all. Both are single-read forms whose payload IS the screen,
 * which means the state the class is about — `useApiQuery` keeps `data` when a revalidation
 * of a read that already succeeded fails (`lib/query/client.tsx:51-53`: `staleTime: 30_000`,
 * `retry: 2`, no refetch-on-focus) — arrived as "the form is unchanged", and the state that
 * is not about a refresh — the read never answered — arrived as "here are your settings",
 * rendered from the component's own `useState` defaults.
 *
 * What each page then does with the read it did not get, measured from its route:
 *   - branding: `handleSave` converts every empty field to `null`, and
 *     `app/api/tenant/branding/route.ts:68-71` writes those `null`s into `tenants.logoUrl`,
 *     `faviconUrl` and `customDomain`; `companyName`, `hidePoweredBy`, `customCss` and
 *     `headerLayout` merge into `settings.branding` at :96-98 and :119, and the three colors
 *     go as this file's `#7c3aed`/`#6366f1`/`#f59e0b`. One click on Save over an unseeded
 *     form erased the tenant's branding. Nothing invalidates `['tenant','branding']`
 *     anywhere — `saveMutation.onSuccess` only sets a message — so the refused refresh here
 *     is the remount past `staleTime`, and the outage is the first load that never landed.
 *   - sso: `providers.length` is the derived figure that chooses the VERB of the page's only
 *     write (`isUpdate`: PUT with `providers[0].id`, otherwise POST). Over a read that never
 *     answered it says "create", and `POST` inserts a second row unguarded
 *     (`app/api/tenant/sso/route.ts:138-144`) while `lib/auth/sso.ts:73`/`:137` resolve a
 *     sign-in by provider id. The refused refresh is this page's own Save:
 *     `saveMutation.onSuccess` invalidates `['tenant', 'sso']` — the exact key, with
 *     `retry: false` on the read, so the reload fails at once and the just-saved provider
 *     stays on screen under an unread flag.
 *
 * So both are the #2922 shape the epic points at: a save over an unseeded form is a
 * data-loss path, and the outage arm has to say that instead of quietly leaving Save armed.
 * `failed` blocks the write (disabled button plus the same gate in the handler); `stale`
 * keeps everything and keeps it writable, under a "last read" caveat that names what the
 * refusal cost. Branding has no count to dash — its fields are the read — so nothing on it
 * is dashed; SSO's derived figure is dashed in words ("Provider on file: —") and its absence
 * sentence "No SSO provider configured yet" is reachable only from a read that answered.
 *
 * Fixtures are documentation-only (RFC 2606 `.test` names, `Ada Operator`, nil-variant ids).
 *
 * RED AT BASE — measured on `be35db54` (this branch's parent) with both pages rewound to what
 * main carries and this file as committed: **18 failed | 8 passed (26)**. Twelve of the
 * eighteen put a read in a state the class is about: the six never-answered arms (both outage
 * cards, both save refusals, both messageless fallbacks) and the six refused-refresh arms
 * whose caveat does not exist at base. The other six are the two "Try again" bindings, which
 * at base have no button to click, the mode line a read that answered "none" now has to
 * print, and three source ratchets — the split bindings, the dashed figure, and the
 * guard-blindness case whose rewind patterns match nothing until the banners exist.
 * The 8 that pass at base are the controls this slice must not regress: both pages writing a
 * *kept* read back correctly (a stale save was already the right PUT/POST with the right body,
 * which is why `stale` must not block it), the branding read that answered with no values, and
 * the five pins that hold regardless of the split (no read toast anywhere, the trigger each
 * WHY comment claims, guard + empty baseline, the line ceiling, overlap hygiene).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
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

import BrandingPage from '@/app/tenant/settings/branding/page';
import SSOPage from '@/app/tenant/settings/sso/page';

const BRANDING = '/api/tenant/branding';
const SSO = '/api/tenant/sso';
const PROVIDER_ID = '70000000-0000-0000-0000-000000000001';

/** What `GET /api/tenant/branding` answers for a tenant that has branded itself. */
const BRAND_READ = {
  data: {
    logoUrl: 'https://assets.corp.test/logo.png',
    faviconUrl: 'https://assets.corp.test/favicon.ico',
    primaryColor: '#1f6feb',
    secondaryColor: '#2f81f7',
    accentColor: '#3fb950',
    companyName: 'Acme Workspace',
    customDomain: 'crm.corp.test',
    hidePoweredBy: true,
    customCss: '.portal-header { letter-spacing: .02em }',
    headerLayout: 'centered',
  },
};
/** A tenant that customized nothing: the read answered, and its answer is "no values". */
const BRAND_NOTHING = { data: {} };

const SSO_READ = {
  data: [
    {
      id: PROVIDER_ID,
      providerType: 'oidc' as const,
      name: 'Corp Okta',
      isActive: true,
      config: {
        clientId: 'okta-client-id',
        issuer: 'https://idp.corp.test',
        authorizationEndpoint: 'https://idp.corp.test/authorize',
        tokenEndpoint: 'https://idp.corp.test/token',
        userinfoEndpoint: 'https://idp.corp.test/userinfo',
        redirectUri: 'https://crm.corp.test/api/auth/callback',
      },
    },
  ],
};
const NO_PROVIDERS = { data: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could name: the payload is held, this refresh was refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const BRAND_OUTAGE = 'Failed to load your branding settings';
const BRAND_CAVEAT = 'the branding settings below are the last read';
const SSO_OUTAGE = 'Failed to load your SSO configuration';
const SSO_CAVEAT = 'so the provider below is the last read';

/**
 * Matches of `re` that are NOT inside an alert. The outage copy quotes the claim it retires
 * ("this page's own defaults", "cannot tell whether there is a provider"), so a bare
 * `queryByText` would find the banner's own words and report the lie as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const saveButton = (name: RegExp) =>
  screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = saveButton(name);
  return el !== null && el.disabled === false;
};

let client: QueryClient;
const tree = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** Records every write the page issues, so "a save over an unread form" is measured. */
let writes: { url: string; method: string; body: Record<string, unknown> }[];
function stubFetch() {
  globalThis.fetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    writes.push({
      url,
      method: init?.method ?? 'GET',
      body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>,
    });
    return { ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  registry.byUrl = {};
  writes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubFetch();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('branding: the form that read its own defaults as the tenant\'s answer (#2872)', () => {
  it('a refused refresh keeps the seeded fields and calls them the last read', () => {
    const read = staleRead(BRAND_READ);
    registry.byUrl = { [BRANDING]: read };
    wrapped(<BrandingPage />);
    expect(screen.getByDisplayValue('https://assets.corp.test/logo.png')).toBeTruthy();
    expect(screen.getByDisplayValue('Acme Workspace')).toBeTruthy();
    expect(screen.getAllByDisplayValue('#1f6feb')).toHaveLength(2);
    expect(screen.getByDisplayValue('crm.corp.test')).toBeTruthy();
    expect(alerts()).toContain(BRAND_CAVEAT);
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('saving now writes over it');
    expect(alerts()).not.toContain(BRAND_OUTAGE);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the caveat\'s retry re-runs the branding read and no other', () => {
    // Both reads are served at once here: the two settings pages share nothing, and the
    // banner must be bound to the one it belongs to.
    const brandingRead = staleRead(BRAND_READ);
    const ssoRead = staleRead(SSO_READ);
    registry.byUrl = { [BRANDING]: brandingRead, [SSO]: ssoRead };
    wrapped(<BrandingPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(brandingRead.refetch).toHaveBeenCalledTimes(1);
    expect(ssoRead.refetch).not.toHaveBeenCalled();
  });

  it('stays writable over a last read, and saves what the last read held', async () => {
    registry.byUrl = { [BRANDING]: staleRead(BRAND_READ) };
    wrapped(<BrandingPage />);
    // The labels are not associated with their inputs on this form (`<label>` without
    // `htmlFor`), so the field is found by the value the read put in it.
    fireEvent.change(screen.getByDisplayValue('Acme Workspace'), { target: { value: 'Acme Workspace West' } });
    // The switch is a kept control: on a refused refresh it is still the tenant's stored
    // `true`, and still clickable — this is the arm where the page is allowed to write.
    const badge = screen.getByRole('switch');
    expect(badge.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(badge);
    expect(badge.getAttribute('aria-checked')).toBe('false');
    expect(offered(/save branding/i)).toBe(true);
    fireEvent.click(saveButton(/save branding/i) as HTMLButtonElement);

    await waitFor(() => expect(writes).toHaveLength(1), { interval: 10 });
    expect(writes[0]!.url).toBe(BRANDING);
    expect(writes[0]!.method).toBe('PUT');
    expect(writes[0]!.body).toMatchObject({
      companyName: 'Acme Workspace West',
      logoUrl: 'https://assets.corp.test/logo.png',
      customDomain: 'crm.corp.test',
      primaryColor: '#1f6feb',
      hidePoweredBy: false,
    });
    expect(writes[0]!.body['customCss']).toBe('.portal-header { letter-spacing: .02em }');
  });

  it('a read that never answered is an outage, and the defaults are not offered as settings', () => {
    const read = failed('Request failed (500)');
    registry.byUrl = { [BRANDING]: read };
    wrapped(<BrandingPage />);
    expect(alerts()).toContain(`${BRAND_OUTAGE}: Request failed (500)`);
    // The lie this retires: the form below is the component's `useState`, and the copy says so.
    expect(alerts()).toContain("this page's own defaults");
    expect(alerts()).toContain('saving now writes them over the logo, colors, custom domain and CSS on file');
    expect(alerts()).not.toContain('last read');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('offers no save over the form the read never seeded', async () => {
    registry.byUrl = { [BRANDING]: failed() };
    wrapped(<BrandingPage />);
    expect(offered(/save branding/i), 'Save Branding is armed over an unseeded form').toBe(false);
    fireEvent.click(saveButton(/save branding/i) as HTMLButtonElement);
    // And the handler holds the same gate, so a submit that reaches it another way is still
    // refused: the body it would have sent nulls logoUrl/faviconUrl/companyName/customDomain
    // and paints the three colors from this file (branding/route.ts:68-71, :96-98, :119).
    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes, 'an unread read still let a write through').toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('says nothing about freshness for a read that answered with no values', () => {
    registry.byUrl = { [BRANDING]: ok(BRAND_NOTHING) };
    wrapped(<BrandingPage />);
    expect(alerts()).toBe('');
    expect(offered(/save branding/i), 'a tenant with nothing branded may still brand itself').toBe(true);
  });

  it('a refused refresh over an answered "no values" is still a last read, not an outage', () => {
    registry.byUrl = { [BRANDING]: staleRead(BRAND_NOTHING) };
    wrapped(<BrandingPage />);
    expect(alerts()).toContain(BRAND_CAVEAT);
    expect(alerts()).not.toContain(BRAND_OUTAGE);
    expect(offered(/save branding/i)).toBe(true);
  });

  it('names the server when the refusal carries no message', () => {
    registry.byUrl = { [BRANDING]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() } };
    wrapped(<BrandingPage />);
    expect(alerts()).toContain(`${BRAND_OUTAGE}: no response from the server`);
    expect(alerts()).not.toContain('undefined');
  });

  it('shows the branding and says nothing when the read answers', async () => {
    registry.byUrl = { [BRANDING]: ok(BRAND_READ) };
    const view = wrapped(<BrandingPage />);
    expect(screen.getByDisplayValue('Acme Workspace')).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(alerts()).toBe('');

    // The save's own reload is the operator's next action: good read → refused → good read.
    registry.byUrl = { [BRANDING]: staleRead(BRAND_READ) };
    view.rerender(tree(<BrandingPage />));
    expect(screen.getByDisplayValue('Acme Workspace')).toBeTruthy();
    expect(alerts()).toContain(BRAND_CAVEAT);

    registry.byUrl = { [BRANDING]: ok(BRAND_READ) };
    view.rerender(tree(<BrandingPage />));
    expect(alerts()).toBe('');
  });
});

describe('sso: the form whose unread read chose "create" over "update" (#2872)', () => {
  it('a refused refresh keeps the provider and calls it the last read', () => {
    const read = staleRead(SSO_READ);
    registry.byUrl = { [SSO]: read };
    wrapped(<SSOPage />);
    // The form really is holding the last read, not a blank.
    expect(screen.getByDisplayValue('Corp Okta')).toBeTruthy();
    expect(screen.getByDisplayValue('okta-client-id')).toBeTruthy();
    expect(screen.getByDisplayValue('https://idp.corp.test')).toBeTruthy();
    expect(screen.getByDisplayValue('https://crm.corp.test/api/auth/callback')).toBeTruthy();
    expect(alerts()).toContain(SSO_CAVEAT);
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('A provider added or replaced since is not reflected here');
    expect(alerts()).not.toContain(SSO_OUTAGE);
    // The derived figure prints the real provider, not a dash.
    expect(screen.getByText('Provider on file: Corp Okta — saving updates it')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the caveat\'s retry re-runs the sso read and no other', () => {
    const ssoRead = staleRead(SSO_READ);
    const brandingRead = staleRead(BRAND_READ);
    registry.byUrl = { [BRANDING]: brandingRead, [SSO]: ssoRead };
    wrapped(<SSOPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(ssoRead.refetch).toHaveBeenCalledTimes(1);
    expect(brandingRead.refetch).not.toHaveBeenCalled();
  });

  it('stays writable over a last read, and PUTs to the provider that read named', async () => {
    registry.byUrl = { [SSO]: staleRead(SSO_READ) };
    wrapped(<SSOPage />);
    expect(offered(/save sso configuration/i)).toBe(true);
    fireEvent.click(saveButton(/save sso configuration/i) as HTMLButtonElement);

    await waitFor(() => expect(writes).toHaveLength(1), { interval: 10 });
    expect(writes[0]!.method).toBe('PUT');
    expect(writes[0]!.body['id']).toBe(PROVIDER_ID);
    expect(writes[0]!.body['config']).toMatchObject({ issuer: 'https://idp.corp.test' });
    // The refused refresh the split is about is this write's own reload, on the exact key.
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tenant', 'sso'] });
  });

  it('a read that never answered is an outage, and the dashed figure says so', () => {
    const read = failed('Request failed (503)');
    registry.byUrl = { [SSO]: read };
    wrapped(<SSOPage />);
    expect(alerts()).toContain(`${SSO_OUTAGE}: Request failed (503)`);
    expect(alerts()).toContain('cannot tell whether there is a provider to update');
    expect(alerts()).not.toContain('last read');
    expect(screen.getByText('Provider on file: — (this page could not read it)')).toBeTruthy();
    expect(claimsOutsideAlerts(/No SSO provider configured yet/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('offers no save when nothing answered, because the verb would be a guess', async () => {
    registry.byUrl = { [SSO]: failed() };
    wrapped(<SSOPage />);
    expect(offered(/save sso configuration/i), 'Save is armed over an unread provider list').toBe(false);
    fireEvent.click(saveButton(/save sso configuration/i) as HTMLButtonElement);
    // The handler gate: POST would insert a second active provider (sso/route.ts:138-144)
    // and leave the real one untouched, with the IdP fields blank.
    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes, 'an unread read still chose a verb').toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('says "none yet" when the read answered "none", with no alert, and still lets the first save', () => {
    registry.byUrl = { [SSO]: ok(NO_PROVIDERS) };
    wrapped(<SSOPage />);
    expect(screen.getByText('No SSO provider configured yet — saving creates the first one.')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(offered(/save sso configuration/i)).toBe(true);
  });

  it('an empty last read still says none, and says that is all it saw', () => {
    // The routine state on this page: the list read empty, the operator saved the first
    // provider, the invalidate was refused, and TanStack handed the empty array back.
    registry.byUrl = { [SSO]: staleRead(NO_PROVIDERS) };
    wrapped(<SSOPage />);
    expect(screen.getByText('No SSO provider configured yet — saving creates the first one.')).toBeTruthy();
    expect(alerts()).toContain(SSO_CAVEAT);
    expect(alerts()).not.toContain(SSO_OUTAGE);
  });

  it('names the server when the refusal carries no message', () => {
    registry.byUrl = { [SSO]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() } };
    wrapped(<SSOPage />);
    expect(alerts()).toContain(`${SSO_OUTAGE}: no response from the server`);
    expect(alerts()).not.toContain('undefined');
  });

  it('shows the provider and says nothing when the read answers', async () => {
    registry.byUrl = { [SSO]: ok(SSO_READ) };
    const view = wrapped(<SSOPage />);
    expect(screen.getByDisplayValue('Corp Okta')).toBeTruthy();
    expect(alerts()).toBe('');

    registry.byUrl = { [SSO]: staleRead(SSO_READ) };
    view.rerender(tree(<SSOPage />));
    expect(alerts()).toContain(SSO_CAVEAT);

    registry.byUrl = { [SSO]: ok(SSO_READ) };
    view.rerender(tree(<SSOPage />));
    expect(alerts()).toBe('');
  });
});

describe('the ratchet these two slices are measured by (#2872)', () => {
  const ROOT = process.cwd();
  const BRAND = 'app/tenant/settings/branding/page.tsx';
  const SSO_FILE = 'app/tenant/settings/sso/page.tsx';
  const srcOf = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the two states apart on both pages, off the read it belongs to', () => {
    for (const [file, err] of [[BRAND, 'brandingError'], [SSO_FILE, 'ssoError']] as const) {
      const s = srcOf(file);
      expect(s, `${file} still refuses to look at its own error`)
        .toMatch(new RegExp(`error: ${err},\\s*\\n\\s*refetch: refetch`));
      expect(s, `${file} never separates the outage from a refused refresh`)
        .toMatch(new RegExp(`const failed = Boolean\\(${err}\\) && !data;`));
      expect(s, `${file} keeps a held payload without calling it the last read`)
        .toMatch(new RegExp(`const stale = Boolean\\(${err}\\) && Boolean\\(data\\);`));
      expect(s, `${file} can print an undefined reason`)
        .toMatch(new RegExp(`${err}\\?\\.message \\|\\| 'no response from the server'`));
      expect(s, `${file} gates an arm on the bare flag`)
        .not.toMatch(new RegExp(`\\{${err} && \\(`));
      expect(s, `${file} blocks the write on the kept read instead of the outage`)
        .toMatch(/disabled=\{saving \|\| failed\}/);
    }
  });

  it('has no read toast to remove, because neither page ever had one', () => {
    // The premise this slice was assigned on is the toast-only panel; these two are the
    // silent spelling of the same class. Pinned so a later edit cannot move the read
    // failure into a fading toast, and so the mutation feedback stays where it is.
    for (const file of [BRAND, SSO_FILE]) {
      const s = srcOf(file);
      expect(s, `${file} toasts the read failure from the render body`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(s, `${file} moved the read failure into an effect`).not.toMatch(/useEffect\(\(\) => \{ if \(error\) toast\.error/);
      expect(s, `${file} carries a page state on a fading toast`).not.toMatch(/react-hot-toast/);
      expect(s, `${file} stopped reporting a failed save to the panel itself`).toMatch(/setMessage\(\{ type: 'error'/);
    }
  });

  it('dashes only what a read can make unread', () => {
    const brand = srcOf(BRAND);
    expect(brand, 'branding invented a total it never had').not.toMatch(/\? '—'/);
    const sso = srcOf(SSO_FILE);
    expect(sso, 'the create/update figure is not dashed on the outage')
      .toMatch(/\{failed\n\s*\?\s*'Provider on file: —/);
    expect(sso, 'the figure went back to being read off the bare flag').not.toMatch(/\{ssoError &&/);
    expect(sso, 'the outage arm no longer blocks the write it is about').toMatch(/if \(failed\) return;/);
    expect(sso, 'the verb is no longer derived from the provider list the read returned')
      .toMatch(/const method = isUpdate \? 'PUT' : 'POST';/);
  });

  it('names the trigger each split\'s WHY comment claims', () => {
    // branding: nothing invalidates its key at all, so the refused refresh is the remount.
    expect(srcOf(BRAND), 'branding grew an invalidateQueries; the stale state needs re-justifying')
      .not.toMatch(/invalidateQueries/);
    expect(srcOf(BRAND)).toMatch(/\['tenant', 'branding'\],\n\s*'\/api\/tenant\/branding'/);
    // sso: the Save's own reload, on the exact key, with retry:false on the read.
    const sso = srcOf(SSO_FILE);
    expect(sso, 'the save stopped reloading the read the split is about')
      .toMatch(/queryKey: \['tenant', 'sso'\]/);
    expect(sso).toMatch(/\['tenant', 'sso'\],\n\s*'\/api\/tenant\/sso',\n\s*\{ retry: false \}/);
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const cases: [string, [RegExp, string][]][] = [
      [BRAND, [
        [/\{failed && \(/, '{brandingError && ('],
        [/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/, '\n'],
        [/const failed = Boolean\(brandingError\) && !data;/, 'const failed = Boolean(brandingError);'],
      ]],
      [SSO_FILE, [
        [/\{failed && \(/, '{ssoError && ('],
        [/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/, '\n'],
        [/const failed = Boolean\(ssoError\) && !data;/, 'const failed = Boolean(ssoError);'],
      ]],
    ];
    for (const [file, rewinds] of cases) {
      const src = srcOf(file);
      expect(inspect(file, src).offends, `${file} is on the guard's list`).toBe(false);
      for (const [pattern, replacement] of rewinds) {
        expect(src, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
        expect(
          inspect(file, src.replace(pattern, replacement)).offends,
          `${file} would be visible to the guard once the split is taken back out: ${replacement}`,
        ).toBe(false);
      }
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality: it is `{}` on main today, and pinning the count is what
    // #2858, #2865 and #2866 each had to undo.
    expect(files.length).toBeLessThanOrEqual(3);
    for (const file of [BRAND, SSO_FILE]) {
      expect(files, `${file} belongs on the baseline only if a reviewed PR says why`).not.toContain(file);
    }
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('keeps both pages inside the line ceiling the guard allows', () => {
    for (const file of [BRAND, SSO_FILE]) {
      const lines = srcOf(file).split('\n').length - 1;
      expect(lines, `${file} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the suites that already speak about these endpoints to their own ground', () => {
    // Overlap hygiene, counted rather than assumed: this slice is the only suite that mounts
    // either page — #2520's suite tests the route and only names the form in its doc comment
    // — so the "last read" copy cannot be asserted twice in two voices.
    const DIR = 'tests/unit';
    const mounters = readdirSync(join(ROOT, DIR))
      .filter((f) => /\.test\.tsx?$/.test(f))
      .filter((f) => /from '@\/app\/tenant\/settings\/(branding|sso)\/page/.test(readFileSync(join(ROOT, DIR, f), 'utf8')));
    expect(mounters).toEqual(['panel-page-error-not-empty-branding-sso-stale-2872.test.tsx']);

    for (const t of [
      `${DIR}/sso-secret-projection-2520.test.ts`,
      `${DIR}/panel-page-error-not-empty-tenant-settings-2829.test.tsx`,
      `${DIR}/panel-fetch-error-not-empty-2823.test.tsx`,
    ]) {
      expect(readFileSync(join(ROOT, t), 'utf8'), `${t} now speaks about a kept read`).not.toMatch(/last read/);
    }
    // And rbac is #2928's own three-read split, with its own suite: this slice must not have
    // re-cut it or reached into it.
    expect(srcOf('app/tenant/settings/rbac/page.tsx')).toMatch(/const arStale = Boolean\(arError\) && Boolean\(arData\);/);
  });
});
