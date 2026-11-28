// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const registry = vi.hoisted(() => ({ result: { data: undefined as unknown, error: null as Error | null, isLoading: false } }));

vi.mock('@/lib/query/client', () => ({ useApiQuery: () => registry.result }));
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: vi.fn(), theme: 'system' }) }));
vi.mock('@/components/tenant/settings/sidebar-customize-section', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import PreferencesPage from '@/app/tenant/settings/preferences/page';

let client: QueryClient;
const mount = () => render(
  <QueryClientProvider client={client}><PreferencesPage /></QueryClientProvider> as ReactNode,
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => vi.restoreAllMocks());

describe('#3408: preferences does not offer to save defaults read during an outage', () => {
  it('a failed read is announced and both write controls are disabled', () => {
    registry.result = { data: undefined, error: new Error('Request failed (503)'), isLoading: false };
    mount();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Preferences could not be loaded');
    expect(alert.textContent).toContain('not your saved settings');
    expect((screen.getByRole('button', { name: /save preferences/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /reset to workspace defaults/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a healthy read shows no alert', () => {
    registry.result = { data: { preferences: { locale: 'en' }, workspace_defaults: {} }, error: null, isLoading: false };
    mount();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Preferences')).toBeTruthy();
  });
});
