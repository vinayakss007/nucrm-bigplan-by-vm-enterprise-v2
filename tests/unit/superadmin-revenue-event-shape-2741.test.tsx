// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2741 — the super-admin Revenue page throws as soon as a billing event exists.
 *
 * `app/superadmin/revenue/page.tsx:26-29` types the event row as
 * `{ id, event_type, tenant_name?, amount?, created_at }` and `:39` fills it from
 * `GET /api/superadmin/revenue`, whose events projection is camelCase
 * (`app/api/superadmin/revenue/route.ts:35-44`: `eventType`, `tenantName`,
 * `createdAt`, plus `amount` as a `numeric` — which Drizzle hands back as a
 * string because no pg type parser is registered). `useApiQuery<RevenueData>` is
 * an assertion, so `e.event_type` is `undefined` at runtime and
 *
 *     e.event_type.includes('paid')          (page.tsx:166)
 *     e.event_type.replace(/_/g,' ')         (page.tsx:171)
 *
 * throw a TypeError inside `.map()` — the whole page render dies, not just the
 * row. The same drift makes the tenant label fall back to `Unknown tenant`
 * (`:173`) and the timestamp to `—` (`:176`) even if the throw were survived.
 *
 * The `mrr` half of the payload really IS snake_case at the route
 * (`free_tier`, `arr_monthly_equiv` — route.ts:22-31), so those cards are pinned
 * as controls here rather than "fixed".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseApiQuery = vi.fn();
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (key: readonly unknown[]) => mockUseApiQuery(key),
}));

import RevenuePage from '@/app/superadmin/revenue/page';

/** GET /api/superadmin/revenue as route.ts:52 really answers it. */
const revenuePayload = {
  data: {
    mrr: { mrr: '1280', paying: 12, trialing: 3, free_tier: 40, churned: 2, arr_monthly_equiv: '1280.0000' },
    events: [
      { id: 'e1', tenantId: 't1', eventType: 'invoice.paid', amount: '79.00', currency: 'usd', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), tenantName: 'Acme Analytics' },
      { id: 'e2', tenantId: 't2', eventType: 'payment_failed', amount: '29.00', currency: 'usd', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), tenantName: 'Northwind Labs' },
    ],
  },
  mrr: { mrr: '1280', paying: 12, trialing: 3, free_tier: 40, churned: 2, arr_monthly_equiv: '1280.0000' },
  events: [
    { id: 'e1', tenantId: 't1', eventType: 'invoice.paid', amount: '79.00', currency: 'usd', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), tenantName: 'Acme Analytics' },
    { id: 'e2', tenantId: 't2', eventType: 'payment_failed', amount: '29.00', currency: 'usd', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), tenantName: 'Northwind Labs' },
  ],
};

function stubQueries(revenue: unknown) {
  mockUseApiQuery.mockImplementation((key: readonly unknown[]) => {
    const name = (key ?? []).map(String).join('/');
    if (name.includes('tenants')) return { data: { data: [] }, isLoading: false, error: null };
    return { data: revenue, isLoading: false, error: null };
  });
}

function renderRevenue() {
  stubQueries(revenuePayload);
  // The base bug is a throw during render, so the call itself is guarded: an
  // uncaught TypeError must fail the test with its own message, not abort the run.
  let error: unknown = null;
  try {
    render(<RevenuePage />);
  } catch (err) {
    error = err;
  }
  expect(error, `render threw: ${String(error)}`).toBeNull();
}

describe('the Revenue page reads its billing events in the shape the route sends (#2741)', () => {
  beforeEach(() => mockUseApiQuery.mockReset());

  it('renders the event type instead of throwing on it', () => {
    renderRevenue();
    expect(screen.getByText('invoice.paid')).toBeTruthy();
    expect(screen.getByText('payment failed')).toBeTruthy();
  });

  it('names the tenant instead of the "Unknown tenant" fallback', () => {
    renderRevenue();
    expect(screen.getByText('Acme Analytics')).toBeTruthy();
    expect(screen.getByText('Northwind Labs')).toBeTruthy();
    expect(screen.queryByText('Unknown tenant')).toBeNull();
  });

  it('shows when each event happened instead of an em dash', () => {
    renderRevenue();
    // "2 days ago" / "5 days ago" — formatRelativeTime returns '—' for undefined.
    expect(screen.getAllByText(/ago$/).length).toBe(2);
  });

  it('formats the amount it is actually given (a numeric arrives as a string)', () => {
    renderRevenue();
    // '$79' is also the Pro plan's monthly price in the breakdown table, so the
    // point here is that no event row fell through to the '$0' of an unparseable
    // amount.
    expect(screen.getAllByText('$79').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$29').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
  });

  // Guard — the mrr half of the payload really is snake_case at the route
  // (route.ts:22-31), so the four metric cards must keep working after the fix.
  it('the snake_case mrr cards keep rendering once the event list stops throwing', () => {
    renderRevenue();
    const cardValues = screen.getAllByText(/^(\$[\d,.]+|\d+)$/)
      .filter(el => el.className.includes('text-2xl'))
      .map(el => el.textContent);
    expect(cardValues, cardValues.join(',')).toEqual(['$1,280', '12', '40', '$107']);
  });

  it('an empty event list still shows the webhook setup panel', () => {
    stubQueries({ mrr: { mrr: '0', paying: 0, trialing: 0, free_tier: 0 }, events: [] });
    render(<RevenuePage />);
    expect(screen.getByText('Setup Stripe webhook')).toBeTruthy();
    // The panel itself lists "invoice.paid" as a recommended event, so the
    // negative assertion is on the row content, not the event name.
    expect(screen.queryByText('Acme Analytics')).toBeNull();
  });
});
