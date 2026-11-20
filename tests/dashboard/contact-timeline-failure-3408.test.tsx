// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the unified contact timeline used to map every refused feed to
 * `{ data: [] }`, rendering "No interactions recorded yet." during a partial
 * outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import ContactTimeline from '@/components/tenant/contact-timeline';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const anActivity = {
  id: 'A1', action: 'Called', description: 'Intro call', created_at: '2026-11-18T00:00:00Z',
};
const mount = () => render(<ContactTimeline contactId="C1" />);

function stubFetch(make: (url: string) => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => make(String(input)));
}

const allOk = () => resp({ data: [] });
const allFail = () => resp({ error: 'offline' }, false, 500);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: contact timeline distinguishes a failed load from a quiet contact', () => {
  it('failed feeds show an error, not "No interactions recorded yet."', async () => {
    stubFetch(allFail);
    mount();
    await waitFor(() => expect(screen.getByText(/Interactions could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No interactions recorded yet.')).toBeNull();
  });

  it('genuinely empty feeds still show the normal empty state', async () => {
    stubFetch(allOk);
    mount();
    await waitFor(() => expect(screen.getByText('No interactions recorded yet.')).toBeTruthy());
    expect(screen.queryByText(/Interactions could not be loaded/)).toBeNull();
  });

  it('a successful feed still renders its entries', async () => {
    stubFetch((url) => url.includes('/activities') ? resp({ data: [anActivity] }) : allOk());
    mount();
    await waitFor(() => expect(screen.getByText('Called')).toBeTruthy());
    expect(screen.queryByText(/Interactions could not be loaded/)).toBeNull();
  });
});
