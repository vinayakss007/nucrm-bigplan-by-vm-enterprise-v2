// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — contact detail tabs must say "could not load" when their fetch
 * fails, instead of rendering the same empty state as a genuinely empty tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ContactDetailClient from '@/components/tenant/contact-detail-client';

const loggerState = vi.hoisted(() => ({ onLogged: (() => {}) as () => void }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));
vi.mock('@/components/tenant/contact-timeline', () => ({ default: () => null }));
vi.mock('@/components/tenant/call-logger', () => ({
  CallLogger: ({ onLogged }: { onLogged: () => void }) => {
    loggerState.onLogged = onLogged;
    return null;
  },
  CallLogList: () => null,
}));

const contact = {
  id: 'C1', tenant_id: 'T1', created_by: null, assigned_to: null, company_id: null,
  first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.io', phone: null,
  city: null, country: null, website: null, linkedin_url: null, tags: null, notes: null,
  lead_source: null, lead_status: null, score: 0, lifecycle_stage: null, custom_fields: null,
  is_archived: false, do_not_contact: false,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  company_name: null, assigned_name: null, created_by_name: null,
};

const callRow = {
  id: 'CALL1', contactId: 'C1', direction: 'inbound', duration: 30,
  notes: 'hello', phoneNumber: '+100', createdAt: '2026-01-02T00:00:00Z', userName: 'Ada',
};

function stubFetch(handlers: Record<string, () => Promise<unknown>>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(handlers).find(k => url.includes(k));
    if (!key) return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
    return handlers[key]() as Promise<Response>;
  });
}

const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
const ok = (data: unknown[]) => Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) });

function renderDetail() {
  return render(
    <ContactDetailClient
      contact={contact}
      initialActivities={[]}
      deals={[]}
      tasks={[]}
      companies={[]}
      teamMembers={[]}
      permissions={{ canEdit: false, canDelete: false, canAssign: false }}
      userId="U1"
      callLogs={[callRow]}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: contact detail tab failures are not rendered as empty states', () => {
  it('history shows a load failure instead of "No edit history yet"', async () => {
    stubFetch({ '/api/tenant/history/contact': fail });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(screen.getByText('Could not load edit history')).toBeTruthy());
    expect(screen.queryByText('No edit history yet')).toBeNull();
  });

  it('leads show a load failure instead of "No leads linked"', async () => {
    stubFetch({ '/api/tenant/contacts/C1/leads': fail });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Leads' }));
    await waitFor(() => expect(screen.getByText('Could not load leads')).toBeTruthy());
    expect(screen.queryByText('No leads linked to this contact yet')).toBeNull();
  });

  it('a failed call-log refresh shows an error and keeps the rows on screen', async () => {
    stubFetch({ '/api/tenant/calls': fail });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Calls (1)' }));
    await act(async () => { loggerState.onLogged(); });
    await waitFor(() => expect(screen.getByText('Could not load call logs')).toBeTruthy());
    // The count comes from the preserved rows, not from the failed response.
    expect(screen.getByRole('button', { name: 'Calls (1)' })).toBeTruthy();
  });

  it('a healthy history still renders its rows normally', async () => {
    stubFetch({
      '/api/tenant/history/contact': () => ok([{
        id: 'H1', fieldLabel: 'Stage', oldValue: 'new', newValue: 'qualified',
        createdAt: '2026-01-03T00:00:00Z', userName: 'Ada',
      }]),
    });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(screen.getByText('1 changes')).toBeTruthy());
    expect(screen.getByText('qualified')).toBeTruthy();
    expect(screen.queryByText('Could not load edit history')).toBeNull();
  });
});

describe('#3408: contact follow-ups distinguish a failed server read from an empty list', () => {
  const renderWith = (failed: boolean) => render(
    <ContactDetailClient
      contact={contact} initialActivities={[]} deals={[]} tasks={[]} companies={[]}
      teamMembers={[]} permissions={{ canEdit: false, canDelete: false, canAssign: false }}
      userId="U1" callLogs={[callRow]} followUpsLoadFailed={failed}
    />,
  );

  it('names the failed read instead of "No follow-ups scheduled" or a "(0 open)" count', async () => {
    stubFetch({});
    renderWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Follow-ups' }));
    await waitFor(() => expect(screen.getByText(/Follow-ups could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No follow-ups scheduled')).toBeNull();
    expect(screen.queryByRole('button', { name: /Follow-ups \(0 open\)/ })).toBeNull();
  });

  it('a genuine empty list still shows the normal empty state', async () => {
    stubFetch({});
    renderWith(false);
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups \(0 open\)/ }));
    await waitFor(() => expect(screen.getByText('No follow-ups scheduled')).toBeTruthy());
    expect(screen.queryByText(/Follow-ups could not be loaded/)).toBeNull();
  });
});
