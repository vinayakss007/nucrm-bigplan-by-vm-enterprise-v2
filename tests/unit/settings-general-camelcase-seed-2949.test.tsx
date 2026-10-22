// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2949 — /tenant/settings/general seeded its form from snake_case keys that
 * `GET /api/tenant/workspace` never returns (it serializes the Drizzle row
 * with camelCase aliases: `primaryColor`, `customDomain`, `logoUrl`, `planId`).
 * `undefined || '#7c3aed'` fired on every successful read, so the first save
 * reset the tenant's brand colour to default violet and cleared their custom
 * domain — a write the #2872 gate can never catch, because the read succeeded.
 *
 * These tests mount the page with the camelCase shape the route actually
 * answers with and pin both sides of the boundary:
 *   - the form holds the REAL values, not the defaults;
 *   - the outgoing PATCH stays snake_case, because `route.ts` maps
 *     `body.primary_color`/`body.custom_domain` — that is the write contract;
 *   - the enterprise gate on the custom-domain input now reads `planId`
 *     (it could never enable before, on any plan).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/image', () => ({
  default: (props: { src?: string | { src?: string }; alt?: string }) => {
    const src = typeof props.src === 'string' ? props.src : props.src?.src ?? '';
    return <span data-testid={`image-${props.alt ?? ''}`} data-src={src} />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/settings/general',
}));

import GeneralSettingsPage from '@/app/tenant/settings/general/page';

const WORKSPACE = '/api/tenant/workspace';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GeneralSettingsPage />
    </QueryClientProvider>
  );
}

// The exact shape GET /api/tenant/workspace answers with — camelCase aliases
// on the tenant columns, snake only for the joined plans/subscriptions fields.
const REAL_WORKSPACE = {
  data: {
    name: 'Acme Studio',
    primaryColor: '#0f766e',
    industry: 'Technology',
    subdomain: 'acme-studio',
    customDomain: 'acme.example',
    logoUrl: '/uploads/logo.png',
    planId: 'enterprise',
    settings: { timezone: 'UTC', currency: 'USD', autoInvoiceOnWon: false },
    plan_name: 'Enterprise',
    max_users: 50,
  },
};

beforeEach(() => {
  registry.byUrl = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === WORKSPACE && init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ data: REAL_WORKSPACE.data }) } as Response;
      }
      return { ok: true, json: async () => ({ available: true }) } as Response;
    })
  );
});

describe('#2949: the general settings form seeds from the camelCase the GET returns', () => {
  it('a successful read shows the tenant’s real brand colour and custom domain, not the defaults', () => {
    registry.byUrl[WORKSPACE] = ok(REAL_WORKSPACE);
    renderPage();

    const colorText = screen.getByPlaceholderText('#7c3aed');
    expect((colorText as HTMLInputElement).value).toBe('#0f766e');
    const domain = screen.getByPlaceholderText('crm.yourcompany.com');
    expect((domain as HTMLInputElement).value).toBe('acme.example');
  });

  it('the PATCH that goes out is snake_case AND carries those real values — the reset is what this issue is about', async () => {
    registry.byUrl[WORKSPACE] = ok(REAL_WORKSPACE);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Save Settings/ }));
    await waitFor(() => {
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) => String(url) === WORKSPACE && (init as RequestInit | undefined)?.method === 'PATCH'
      );
      expect(call, 'PATCH /api/tenant/workspace was never sent').toBeTruthy();
    });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => String(url) === WORKSPACE && (init as RequestInit | undefined)?.method === 'PATCH'
    )!;
    const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.primary_color, 'a renamed read key must not silently reset the brand colour').toBe('#0f766e');
    expect(body.custom_domain, 'a renamed read key must not silently clear the custom domain').toBe('acme.example');
    expect(body.name).toBe('Acme Studio');
    expect(body).not.toHaveProperty('primaryColor');
  });

  it('the enterprise gate reads planId — an enterprise tenant gets an enabled domain field, everyone else gets the upgrade hint', () => {
    registry.byUrl[WORKSPACE] = ok(REAL_WORKSPACE);
    renderPage();
    const domain = screen.getByPlaceholderText('crm.yourcompany.com') as HTMLInputElement;
    expect(domain.disabled, 'planId=enterprise must enable the custom-domain input').toBe(false);
    expect(screen.queryByText(/Custom domains require the Enterprise plan/)).toBeNull();
    expect(screen.getByText('DNS Setup Required')).toBeTruthy();
  });

  it('a non-enterprise tenant still sees the upgrade hint (the gate is a gate, not gone)', () => {
    registry.byUrl[WORKSPACE] = ok({
      data: { ...REAL_WORKSPACE.data, planId: 'pro', customDomain: '', primaryColor: '#0f766e' },
    });
    renderPage();
    const domain = screen.getByPlaceholderText('crm.yourcompany.com') as HTMLInputElement;
    expect(domain.disabled).toBe(true);
    expect(screen.getByText(/Custom domains require the Enterprise plan/)).toBeTruthy();
  });

  it('the logo preview reads the logoUrl the GET actually returns', () => {
    registry.byUrl[WORKSPACE] = ok(REAL_WORKSPACE);
    renderPage();
    expect(screen.getByTestId('image-Logo').getAttribute('data-src')).toBe('/uploads/logo.png');
  });
});

describe('#2949 static: the snake_case read keys stay dead', () => {
  const src = readFileSync(join(process.cwd(), 'app/tenant/settings/general/page.tsx'), 'utf8');

  it('WorkspaceData no longer declares the keys the GET never sends, and seeds from camelCase', () => {
    expect(src).not.toMatch(/primary_color\?:\s*string/);
    expect(src).not.toMatch(/custom_domain\?:\s*string/);
    expect(src).not.toMatch(/plan_id\?:\s*string/);
    expect(src).toMatch(/primary_color:\s*fetchedTenant\.primaryColor \|\| '#7c3aed'/);
    expect(src).toMatch(/custom_domain:\s*fetchedTenant\.customDomain \|\| ''/);
    expect(src).toMatch(/tenant\?\.planId !== 'enterprise'/);
  });

  it('the write contract stays snake_case at the boundary — the form is sent as-is', () => {
    expect(src).toMatch(/body:\s*JSON\.stringify\(form\)/);
    expect(src).toMatch(/primary_color:'#7c3aed'/);
  });
});
