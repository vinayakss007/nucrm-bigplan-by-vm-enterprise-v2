// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 / #1328 — `tenant/settings/industry-templates`.
 *
 * The setup gallery read `product_templates` through `useQuery` + a raw `fetch`
 * in `queryFn` and bound only `data` (`const templates = query.data ?? []`). It
 * had no failure branch of any kind, so the two opposite questions were both
 * answered as an empty gallery: a read that never answered rendered zero cards
 * and said nothing — the same screen as "no template is published" — and a
 * refused revalidation took the cards away from a visitor halfway through
 * choosing one, because `useApiQuery` sets `error` while KEEPING `data`
 * (`lib/query/client.tsx`).
 *
 * Measured by running this suite against origin/main's copy of the page
 * (restored into the worktree, then replaced by the fix):
 *   BEFORE — red 13 / green 2 of 15 cases (only the two guard cases passed).
 *   AFTER  — red 0 / green 15 of 15 cases.
 *
 * Convention pinned here: `failed = Boolean(error) && !data` (outage — nothing
 * was read), `stale = Boolean(error) && Boolean(data)` (kept cards, refused
 * refresh), `reason = error?.message || 'no response from the server'`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
const writes = vi.hoisted(() => [] as string[]);
const push = vi.hoisted(() => vi.fn());

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

import IndustryTemplatesPage from '@/app/tenant/settings/industry-templates/page';

const TEMPLATES = '/api/tenant/industry-templates';

// RFC 2606 names + TEST-NET-style ids only: the repo is public.
const card = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-198.51.100.1',
  slug: 'agency',
  name: 'Agency Setup',
  description: 'Fields and pipelines for a services firm.',
  icon: '🤝',
  modules: ['leads', 'deals'],
  custom_fields: [{ fieldKey: 'promo_source' }, { fieldKey: 'deal_size' }],
  pipelines: [{ id: 'pipe-1' }],
  automations: [{ id: 'auto-1' }, { id: 'auto-2' }, { id: 'auto-3' }],
  ...over,
});
const twoCards = {
  data: [
    card(),
    card({
      id: 'tpl-203.0.113.2', slug: 'saas', name: 'SaaS Setup',
      custom_fields: [{ fieldKey: 'plan' }, { fieldKey: 'mrr' }, { fieldKey: 'seat_count' }],
      pipelines: [{ id: 'pipe-1' }, { id: 'pipe-2' }],
      automations: [{ id: 'auto-1' }],
    }),
  ],
};

const ok = (data: unknown): QueryResult => ({
  data, error: null, isLoading: false, isFetching: false, refetch: vi.fn(),
});
const outage = (message: string): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
/** The #2872 shape: a revalidation that refused while the previous read is kept. */
const refused = (message: string, data: unknown): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
const messageless = (data?: unknown): QueryResult => ({
  data, error: Object.assign(new Error(''), { message: '' }), isLoading: false, isFetching: false, refetch: vi.fn(),
});

function mount(result: QueryResult) {
  registry.byUrl = { [TEMPLATES]: result };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IndustryTemplatesPage /></QueryClientProvider>);
}

const alerts = (): HTMLElement[] => screen.queryAllByRole('alert');
const said = (): string => alerts().map((a) => a.textContent ?? '').join(' | ');
const body = (): string => document.body.textContent ?? '';
const pageSource = () => readFileSync('app/tenant/settings/industry-templates/page.tsx', 'utf8');

describe('#2872 industry-templates keeps a refused refresh off the "no templates" screen', () => {
  beforeEach(() => {
    registry.byUrl = {};
    writes.length = 0;
    push.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      writes.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('prints an outage banner when the gallery never answered, and never claims the catalogue is empty', () => {
    mount(outage('502 from the gateway'));
    expect(alerts().length).toBe(1);
    expect(said()).toMatch(/Failed to load industry templates: 502 from the gateway/i);
    expect(body()).not.toMatch(/No industry templates are published yet/i);
  });

  it('keeps every card through a refused refresh and names the read the visitor is looking at', () => {
    mount(refused('network error while revalidating', twoCards));
    expect(screen.getByText('Agency Setup')).toBeTruthy();
    expect(screen.getByText('SaaS Setup')).toBeTruthy();
    expect(alerts().length).toBe(1);
    expect(said()).toMatch(/is the last read: network error while revalidating/i);
    // The outage phrase belongs to an outage, not to a kept read.
    expect(body()).not.toMatch(/Failed to load industry templates/i);
    expect(body()).not.toMatch(/No industry templates are published yet/i);
  });

  it('shows the per-card counts it did read, unchanged, while the refresh is refused', () => {
    mount(refused('offline', twoCards));
    expect(screen.getByText(/2 Custom Fields/)).toBeTruthy();
    expect(screen.getByText(/3 Automations/)).toBeTruthy();
    expect(screen.getByText(/1 Pipelines/)).toBeTruthy();
    expect(screen.getByText(/3 Custom Fields/)).toBeTruthy();
    expect(screen.getByText(/2 Pipelines/)).toBeTruthy();
    expect(screen.getByText(/1 Automations/)).toBeTruthy();
  });

  it('reports a refused refresh on an empty answer as both a last read and an empty catalogue', () => {
    mount(refused('gateway refused', { data: [] }));
    expect(alerts().length).toBe(1);
    expect(said()).toMatch(/is the last read: gateway refused/i);
    expect(body()).toMatch(/No industry templates are published yet/i);
  });

  it('prints the absence sentence alone when the read answered with nothing', () => {
    mount(ok({ data: [] }));
    expect(alerts().length).toBe(0);
    expect(body()).toMatch(/No industry templates are published yet/i);
  });

  it('says nothing extra when the read answered with cards', () => {
    mount(ok(twoCards));
    expect(alerts().length).toBe(0);
    expect(body()).not.toMatch(/last read/i);
    expect(body()).not.toMatch(/No industry templates are published yet/i);
    expect(screen.getByText('Agency Setup')).toBeTruthy();
  });

  it('prints "no response from the server" for a messageless failure instead of undefined', () => {
    mount(messageless());
    expect(said()).toMatch(/no response from the server/i);
    expect(body()).not.toMatch(/undefined/i);
  });

  it('keeps the caveat readable when a messageless failure rides on kept cards', () => {
    mount(messageless(twoCards));
    expect(said()).toMatch(/is the last read: no response from the server/i);
    expect(screen.getByText('Agency Setup')).toBeTruthy();
    expect(body()).not.toMatch(/undefined/i);
  });

  it('retries a refused refresh through that read only, and writes nothing', () => {
    const result = refused('offline', twoCards);
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it('retries an outage without issuing a write, and leaves the banner standing', () => {
    const result = outage('gateway down');
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    expect(said()).toMatch(/Failed to load industry templates: gateway down/i);
  });

  it('leaves the setup path fully usable while the gallery is a last read', async () => {
    mount(refused('offline', twoCards));
    fireEvent.click(screen.getByText('Agency Setup').closest('button') as Element);
    const apply = screen.getByRole('button', { name: /apply setup/i });
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await waitFor(() => expect(writes).toEqual([TEMPLATES]));
    expect(push).toHaveBeenCalledWith('/tenant/dashboard');
  });

  describe('source shape (#2872 convention + the #1328 migration)', () => {
    it('derives failed/stale from data being kept, and keeps the messageless fallback', () => {
      const src = pageSource();
      expect(src).toContain('const failed = Boolean(templatesError) && !templatesBody;');
      expect(src).toContain('const stale = Boolean(templatesError) && Boolean(templatesBody);');
      expect(src).toContain("const reason = templatesError?.message || 'no response from the server';");
      expect(src).toContain('const templates = templatesBody?.data ?? [];');
    });

    it('reads through useApiQuery, not a raw fetch inside a queryFn', () => {
      const src = pageSource();
      expect(src).toContain("import { useApiQuery } from '@/lib/query/client';");
      expect(src).not.toContain('queryFn');
      expect(src).not.toMatch(/from '@tanstack\/react-query'.*useQuery/s);
      expect(src).toContain("['industry-templates'],\n    '/api/tenant/industry-templates',");
    });
  });

  describe('guards stay green and the page stays inside its budget', () => {
    it('keeps the file under the 500-line ceiling with no baseline entry', () => {
      const lines = pageSource().split('\n').length;
      expect(lines).toBeLessThanOrEqual(500);
      const raw = JSON.parse(readFileSync('scripts/file-size-baseline.json', 'utf8')) as Record<string, unknown>;
      const files = (raw.files ?? raw) as Record<string, unknown>;
      expect(files['app/tenant/settings/industry-templates/page.tsx']).toBeUndefined();
    });

    it('passes the panel error-state, file-size and empty-catch guards', () => {
      for (const script of ['check-panel-error-state.mjs', 'check-file-size.mjs', 'check-catch-empty.mjs']) {
        const r = spawnSync('node', [`scripts/${script}`], { encoding: 'utf8' });
        expect(r.status, `${script}: ${r.stderr}`).toBe(0);
      }
    });
  });
});
