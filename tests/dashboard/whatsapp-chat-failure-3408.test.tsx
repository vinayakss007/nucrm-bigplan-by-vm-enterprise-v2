// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed messages load used to render "No messages yet / Send a
 * message to start the conversation", the same text as a new conversation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));

import WhatsAppChat from '@/components/tenant/whatsapp-chat';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aMessage = {
  id: 'M1', direction: 'inbound', message_type: 'text', body: 'Hello there',
  status: 'read', created_at: '2026-11-18T00:00:00Z', sent_at: null,
  delivered_at: null, read_at: null, error_message: null,
};
const mount = () => render(
  <WhatsAppChat contactId="C1" contactName="Ada" contactPhone="+100" />,
);

function stubFetch(messagesResponse: Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes('/messages')) return messagesResponse;
    return resp({ data: [] });
  });
}

function stubTemplateFetch(templatesResponse: Response) {
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes('/templates')) return templatesResponse;
    return resp({ data: [] });
  });
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('#3408: WhatsApp chat distinguishes a failed load from an empty thread', () => {
  it('a failed load shows an error, not "No messages yet"', async () => {
    stubFetch(resp({ error: 'offline' }, false, 500));
    mount();
    await waitFor(() => expect(screen.getByText(/Could not load messages/)).toBeTruthy());
    expect(screen.queryByText('No messages yet')).toBeNull();
    expect(screen.queryByText('Send a message to start the conversation')).toBeNull();
  });

  it('a genuine empty thread still shows the normal empty state', async () => {
    stubFetch(resp({ data: [] }));
    mount();
    await waitFor(() => expect(screen.getByText('No messages yet')).toBeTruthy());
    expect(screen.queryByText(/Could not load messages/)).toBeNull();
  });

  it('a successful load still renders the messages', async () => {
    stubFetch(resp({ data: [aMessage] }));
    mount();
    await waitFor(() => expect(screen.getByText('Hello there')).toBeTruthy());
    expect(screen.queryByText(/Could not load messages/)).toBeNull();
  });
});

describe('#3408: WhatsApp chat distinguishes a failed template read from an empty one', () => {
  it('a failed read exposes its error in the picker instead of hiding the button', async () => {
    stubTemplateFetch(resp({ error: 'WhatsApp is not configured' }, false, 400));
    mount();
    const toggle = await screen.findByText('Templates');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(/Templates could not be loaded/)).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No templates are configured for this WhatsApp account.')).toBeNull();
  });

  it('a Try again button re-issues the templates read', async () => {
    const fetchMock = stubTemplateFetch(resp({ error: 'offline' }, false, 500));
    mount();
    fireEvent.click(await screen.findByText('Templates'));
    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy());
    const before = fetchMock.mock.calls.filter(([input]) => String(input).includes('/templates')).length;
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(([input]) => String(input).includes('/templates')).length;
      expect(after).toBe(before + 1);
    });
  });

  it('a genuine empty success says so without an error alert', async () => {
    stubTemplateFetch(resp({ data: [] }));
    mount();
    fireEvent.click(await screen.findByText('Templates'));
    await waitFor(() => expect(
      screen.getByText('No templates are configured for this WhatsApp account.'),
    ).toBeTruthy());
    expect(screen.queryByText(/Templates could not be loaded/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful retry clears the alert and renders the recovered templates', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/templates')) {
        calls += 1;
        return calls === 1
          ? resp({ error: 'offline' }, false, 500)
          : resp({ data: [{ id: 'T1', name: 'Order update' }] });
      }
      return resp({ data: [] });
    });
    mount();
    fireEvent.click(await screen.findByText('Templates'));
    await waitFor(() => expect(screen.getByText(/Templates could not be loaded/)).toBeTruthy());
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Order update')).toBeTruthy());
    expect(screen.queryByText(/Templates could not be loaded/)).toBeNull();
    expect(screen.queryByText('No templates are configured for this WhatsApp account.')).toBeNull();
  });
});
