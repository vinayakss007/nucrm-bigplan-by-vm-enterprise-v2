// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed record search was rewritten to `{ data: [] }` (and the
 * catch cleared options), so the typeahead said "No matches" during an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { RecordPicker } from '@/components/tenant/record-picker';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const mount = () => render(<RecordPicker kind="contact" value="" onChange={vi.fn()} />);

async function open() {
  fireEvent.click(screen.getByRole('button', { name: /Search/ }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0), { timeout: 3000 });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: record picker distinguishes a failed search from no matches', () => {
  it('a failed search shows an error, not "No matches"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await open();
    await waitFor(() => expect(screen.getByText(/Search could not be completed/)).toBeTruthy());
    expect(screen.queryByText('No matches')).toBeNull();
  });

  it('a genuine empty result still shows "No matches"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount();
    await open();
    await waitFor(() => expect(screen.getByText('No matches')).toBeTruthy());
    expect(screen.queryByText(/Search could not be completed/)).toBeNull();
  });

  it('a successful search still renders the records', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [{ id: 'C1', first_name: 'Ada', last_name: 'Lovelace' }] })));
    mount();
    await open();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText(/Search could not be completed/)).toBeNull();
  });
});

describe('a preselected record shows its name instead of the literal word "Selected"', () => {
  it('hydrates the label from the record endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ id: 'C1', first_name: 'Ada', last_name: 'Lovelace' })));
    render(<RecordPicker kind="contact" value="C1" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText('Selected')).toBeNull();
  });

  it('also accepts the enveloped record shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: { id: 'D1', title: 'Renewal deal' } })));
    render(<RecordPicker kind="deal" value="D1" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Renewal deal')).toBeTruthy());
    expect(screen.queryByText('Selected')).toBeNull();
  });
});
