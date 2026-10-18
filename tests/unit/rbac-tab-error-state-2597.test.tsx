// @vitest-environment jsdom
/**
 * Regression guard for the #2597 "Approval Rules tab 404s but looks empty" defect.
 *
 * The tab fetches `/api/tenant/rbac/approval-rules`, which no longer exists on
 * the deployed build (and #2537/#2538 keep the schema behind anyway). The page
 * read only `{ data, isLoading }` off `useApiQuery`, so `apiFetcher`'s thrown
 * `ApiQueryError` was silently swallowed and replaced by
 * `arData?.data ?? []` — an admin saw "No approval rules configured yet"
 * whether the endpoint returned a real empty list, 404'd, or 500'd. The tab
 * looked healthy while its configuration was in fact unreadable.
 *
 * The fix destructures `error` alongside `data` and gates the empty state on
 * it. These tests pin that contract: a failure renders a `role="alert"` box and
 * NOT the empty-state copy, an honest empty array renders the empty-state copy
 * and NOT a failure, and rows render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseApiQuery = vi.fn();
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
}));

import RBACSettingsPage from '@/app/tenant/settings/rbac/page';

type QueryResult = { data?: unknown; isLoading: boolean; error: Error | null };

function stubQueries(overrides: Partial<Record<'field-permissions' | 'record-permissions' | 'approval-rules', QueryResult>> = {}) {
  const ok: QueryResult = { data: { data: [] }, isLoading: false, error: null };
  const table: Record<string, QueryResult> = {
    'field-permissions': overrides['field-permissions'] ?? ok,
    'record-permissions': overrides['record-permissions'] ?? ok,
    'approval-rules': overrides['approval-rules'] ?? ok,
  };
  mockUseApiQuery.mockImplementation((key: readonly unknown[]) => {
    if (!Array.isArray(key)) return ok;
    const name = key.map((part) => String(part)).join('/');
    for (const [tab, result] of Object.entries(table)) {
      if (name.includes(tab)) return result;
    }
    return ok;
  });
}

function failWith(status: number): Error {
  const err = new Error(`Request failed (${status})`) as Error & { status: number };
  err.status = status;
  return err;
}

function openTab(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('rbac page — failures are no longer mistaken for empty lists (#2597)', () => {
  beforeEach(() => mockUseApiQuery.mockReset());

  it('approval-rules 404 renders an error, not the "none configured" empty state', () => {
    stubQueries({ 'approval-rules': { data: undefined, isLoading: false, error: failWith(404) } });
    render(<RBACSettingsPage />);
    openTab('Approval Rules');

    expect(screen.getByRole('alert').textContent).toContain('Failed to load approval rules');
    expect(screen.getByRole('alert').textContent).toContain('404');
    expect(screen.queryByText(/No approval rules configured yet/)).toBeNull();
  });

  it('approval-rules 500 is also distinguishable from the empty state', () => {
    stubQueries({ 'approval-rules': { data: undefined, isLoading: false, error: failWith(500) } });
    render(<RBACSettingsPage />);
    openTab('Approval Rules');

    expect(screen.getByRole('alert').textContent).toContain('500');
    expect(screen.queryByText(/No approval rules configured yet/)).toBeNull();
  });

  it('a genuinely empty approval-rules list still says "none configured", with no error', () => {
    stubQueries({ 'approval-rules': { data: { data: [] }, isLoading: false, error: null } });
    render(<RBACSettingsPage />);
    openTab('Approval Rules');

    expect(screen.getByText(/No approval rules configured yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('approval rules with content render their rows', () => {
    stubQueries({
      'approval-rules': {
        data: {
          data: [
            {
              id: 'r1',
              name: 'Deals above $50k',
              entityType: 'deals',
              conditions: { amount: { gt: 50000 } },
              approvers: ['manager'],
              isActive: true,
            },
          ],
        },
        isLoading: false,
        error: null,
      },
    });
    render(<RBACSettingsPage />);
    openTab('Approval Rules');

    expect(screen.getByText('Deals above $50k')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('field-permissions failure surfaces on the default tab too', () => {
    stubQueries({ 'field-permissions': { data: undefined, isLoading: false, error: failWith(403) } });
    render(<RBACSettingsPage />);

    expect(screen.getByRole('alert').textContent).toContain('Failed to load field permissions');
    expect(screen.queryByText(/No field permissions configured yet/)).toBeNull();
  });

  it('record-permissions failure surfaces on its tab', () => {
    stubQueries({ 'record-permissions': { data: undefined, isLoading: false, error: failWith(500) } });
    render(<RBACSettingsPage />);
    openTab('Record Permissions');

    expect(screen.getByRole('alert').textContent).toContain('Failed to load record permissions');
    expect(screen.queryByText(/No record permissions configured yet/)).toBeNull();
  });
});
