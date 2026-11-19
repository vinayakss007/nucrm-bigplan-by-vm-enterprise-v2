// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed related-records fetch returned `{}` for every feed, so the
 * panel said "No follow-ups / quotes / invoices linked to this deal" during
 * a partial outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import DealRelatedPanel from '@/components/tenant/deal-related-panel';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const mount = () => render(<DealRelatedPanel dealId="D1" />);
const allFail = () => resp({ error: 'offline' }, false, 500);
const allOk = (url: string) => {
  if (url.includes('/follow-ups')) return resp({ data: [] });
  if (url.includes('/quotes')) return resp({ quotes: [] });
  return resp({ data: [] });
};

function stubFetch(make: (url: string) => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => make(String(input)));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: deal related panel distinguishes failed feeds from empty sections', () => {
  it('failed feeds show an explicit error, not "No … linked to this deal"', async () => {
    stubFetch(allFail);
    mount();
    await waitFor(() => expect(screen.getByText(/Some related records could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No follow-ups linked to this deal')).toBeNull();
    expect(screen.queryByText('No quotes linked to this deal')).toBeNull();
    expect(screen.queryByText('No invoices linked to this deal')).toBeNull();
  });

  it('genuinely empty feeds still show the normal empty state', async () => {
    stubFetch(allOk);
    mount();
    await waitFor(() => expect(screen.getByText('No follow-ups linked to this deal')).toBeTruthy());
    expect(screen.queryByText(/Some related records could not be loaded/)).toBeNull();
  });

  it('successful feeds still render their records', async () => {
    stubFetch((url) => {
      if (url.includes('/follow-ups')) return resp({ data: [{ id: 'F1', title: 'Call back', dueDate: null, status: 'pending' }] });
      if (url.includes('/quotes')) return resp({ quotes: [{ id: 'Q1', title: 'Proposal', totalAmount: 100, status: 'draft' }] });
      return resp({ data: [{ id: 'I1', invoiceNumber: 'INV-1', totalAmount: 100, dealId: 'D1', status: 'draft' }] });
    });
    mount();
    await waitFor(() => expect(screen.getByText('Call back')).toBeTruthy());
    expect(screen.getByText('Proposal')).toBeTruthy();
    expect(screen.getByText('INV-1')).toBeTruthy();
    expect(screen.queryByText(/Some related records could not be loaded/)).toBeNull();
  });
});
