// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ContactTimeline } from '@/components/tenant/contact-timeline';

const now = new Date();
const mockEvents = [
  { id: '1', event_type: 'note_added', description: 'Added a note', metadata: null, created_at: now.toISOString(), user_name: 'Alice', user_email: 'alice@test.com', user_avatar: null },
  { id: '2', event_type: 'email_sent', description: 'Sent proposal', metadata: null, created_at: new Date(now.getTime() - 60_000).toISOString(), user_name: 'Bob', user_email: 'bob@test.com', user_avatar: null },
];

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: () => Promise.resolve({ data: mockEvents }),
    ok: true,
  } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContactTimeline', () => {
  it('shows loading skeleton on mount', () => {
    const { container } = render(<ContactTimeline contactId="c1" />);
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders events after fetch resolves', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByText('Added a note')).toBeTruthy();
    });
    expect(screen.getByText('Sent proposal')).toBeTruthy();
  });

  it('renders event type labels in the event card', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      const labels = screen.getAllByText('Note added');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows user names on events', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
    });
  });

  it('shows empty state when no events returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ data: [] }),
      ok: true,
    } as Response);
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByText('No activity yet')).toBeTruthy();
    });
  });

  it('renders filter dropdown when not compact', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByText('Filter:')).toBeTruthy();
    });
  });

  it('does not render filter in compact mode', async () => {
    render(<ContactTimeline contactId="c1" compact={true} />);
    await waitFor(() => {
      expect(screen.getByText('Email sent')).toBeTruthy();
    });
    expect(screen.queryByText('Filter:')).toBeNull();
  });

  it('calls fetch with correct URL', async () => {
    render(<ContactTimeline contactId="c1" limit={25} />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tenant/contacts/c1/timeline?limit=25'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it('aborts fetch on unmount', () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const { unmount } = render(<ContactTimeline contactId="c1" />);
    unmount();
    expect(abortSpy).toHaveBeenCalledTimes(1);
    abortSpy.mockRestore();
  });

  it('shows event type options in the filter dropdown', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Events')).toBeTruthy();
    });
  });

  it('shows relative time for events', async () => {
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      const times = screen.getAllByText('just now');
      expect(times.length).toBeGreaterThanOrEqual(1);
    });
  });
});
