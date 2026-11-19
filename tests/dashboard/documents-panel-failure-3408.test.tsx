// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed documents load used to render "No documents attached yet.",
 * the same text as a record with genuinely no attachments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import DocumentsPanel from '@/components/documents/documents-panel';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aDoc = {
  id: 'D1', name: 'proposal.pdf', sizeBytes: 2048, mimeType: 'application/pdf',
  createdAt: '2026-11-18T00:00:00Z',
};
const renderPanel = () => render(<DocumentsPanel entityType="deal" entityId="DEAL1" readOnly />);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: documents panel distinguishes a failed load from an empty list', () => {
  it('a failed load shows an error, not "No documents attached yet."', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Could not load documents/)).toBeTruthy());
    expect(screen.queryByText('No documents attached yet.')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: { documents: [] } })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('No documents attached yet.')).toBeTruthy());
    expect(screen.queryByText(/Could not load documents/)).toBeNull();
  });

  it('a successful load still renders the documents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: { documents: [aDoc] } })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('proposal.pdf')).toBeTruthy());
    expect(screen.queryByText(/Could not load documents/)).toBeNull();
  });
});
