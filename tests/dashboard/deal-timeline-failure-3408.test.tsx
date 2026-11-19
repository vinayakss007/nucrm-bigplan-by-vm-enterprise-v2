// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the deal timeline mapped each refused feed to `{ data: [] }`, so a
 * partial outage rendered "No communication history for this deal yet.".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import DealTimeline from '@/components/tenant/deal-timeline';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const mount = () => render(<DealTimeline dealId="D1" />);
const allOk = () => resp({ data: [] });
const allFail = () => resp({ error: 'offline' }, false, 500);

function stubFetch(make: (url: string) => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => make(String(input)));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: deal timeline distinguishes failed feeds from a quiet deal', () => {
  it('failed feeds show an error, not "No communication history"', async () => {
    stubFetch(allFail);
    mount();
    await waitFor(() => expect(screen.getByText(/Communication history could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No communication history for this deal yet.')).toBeNull();
  });

  it('genuinely empty feeds still show the normal empty state', async () => {
    stubFetch(allOk);
    mount();
    await waitFor(() => expect(screen.getByText('No communication history for this deal yet.')).toBeTruthy());
    expect(screen.queryByText(/Communication history could not be loaded/)).toBeNull();
  });

  it('a successful feed still renders its entries', async () => {
    stubFetch((url) => url.includes('/activities') ? resp({ data: [{ id: 'A1', action: 'Called', created_at: '2026-11-18T00:00:00Z' }] }) : allOk());
    mount();
    await waitFor(() => expect(screen.getByText('Called')).toBeTruthy());
    expect(screen.queryByText(/Communication history could not be loaded/)).toBeNull();
  });
});
