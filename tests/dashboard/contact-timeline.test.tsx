// @vitest-environment jsdom
/**
 * Tests for components/tenant/contact-timeline.tsx.
 *
 * The previous version of this file described a different component: it asserted
 * a `.skeleton-shimmer` class, a `compact` prop, a "Filter:" dropdown, an
 * "All Events" select and the empty text "No activity yet". None of those exist
 * — the component renders `animate-pulse` placeholders, takes only `contactId`,
 * has no filter UI, and says "No interactions recorded yet." All 11 tests failed.
 *
 * They were invisible to CI: `test:unit` runs only `tests/unit`, and
 * `test:integration` only `tests/integration`, so nothing under tests/dashboard
 * is executed by either job — only by `npm test` in the Deploy workflow.
 *
 * Rewritten to describe what the component actually does. The behaviour worth
 * pinning is the merge: it fans out to five endpoints, drops entries with no
 * timestamp, and sorts newest-first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ContactTimeline from '@/components/tenant/contact-timeline';

/** Endpoint -> payload. Any endpoint not named returns an empty list. */
function mockEndpoints(byPath: Record<string, unknown[]>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string) => {
    const match = Object.keys(byPath).find((k) => url.includes(k));
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: match ? byPath[match] : [] }),
    });
  }) as unknown as typeof fetch);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContactTimeline', () => {
  it('shows animate-pulse placeholders while loading', () => {
    mockEndpoints({});
    const { container } = render(<ContactTimeline contactId="c1" />);
    // Rendered synchronously before the fetches resolve.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('queries all five sources for the given contact', async () => {
    mockEndpoints({});
    render(<ContactTimeline contactId="c1" />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    });
    const called = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (c) => c[0]
    );
    for (const path of ['activities', 'calls', 'meetings', 'tasks', 'deals']) {
      expect(called.some((u) => u.includes(`/api/tenant/${path}?contact_id=c1`))).toBe(true);
    }
  });

  it('reports an empty timeline', async () => {
    mockEndpoints({});
    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => {
      expect(screen.getByText('No interactions recorded yet.')).toBeTruthy();
    });
  });

  it('renders an activity with its description and type badge', async () => {
    mockEndpoints({
      activities: [
        { id: 'a1', action: 'Added a note', description: 'Called back', created_at: '2026-01-02T10:00:00Z' },
      ],
    });
    render(<ContactTimeline contactId="c1" />);

    await waitFor(() => expect(screen.getByText('Added a note')).toBeTruthy());
    expect(screen.getByText('Called back')).toBeTruthy();
    expect(screen.getByText('activity')).toBeTruthy();
  });

  it('merges every source into one stream', async () => {
    mockEndpoints({
      activities: [{ id: 'a1', action: 'Note added', created_at: '2026-01-01T00:00:00Z' }],
      calls: [{ id: 'c1', direction: 'inbound', duration: 120, created_at: '2026-01-02T00:00:00Z' }],
      meetings: [{ id: 'm1', title: 'Kickoff', created_at: '2026-01-03T00:00:00Z' }],
      tasks: [{ id: 't1', title: 'Follow up', status: 'open', created_at: '2026-01-04T00:00:00Z' }],
      deals: [{ id: 'd1', title: 'Renewal', amount: 5000, created_at: '2026-01-05T00:00:00Z' }],
    });
    render(<ContactTimeline contactId="c1" />);

    await waitFor(() => expect(screen.getByText('Renewal')).toBeTruthy());
    expect(screen.getByText('Note added')).toBeTruthy();
    expect(screen.getByText('inbound call (120s)')).toBeTruthy();
    expect(screen.getByText('Kickoff')).toBeTruthy();
    expect(screen.getByText('Follow up')).toBeTruthy();
    // Derived descriptions.
    expect(screen.getByText('Status: open')).toBeTruthy();
    expect(screen.getByText('$5,000')).toBeTruthy();
  });

  it('orders entries newest first', async () => {
    mockEndpoints({
      activities: [
        { id: 'old', action: 'Oldest', created_at: '2026-01-01T00:00:00Z' },
        { id: 'new', action: 'Newest', created_at: '2026-06-01T00:00:00Z' },
      ],
    });
    const { container } = render(<ContactTimeline contactId="c1" />);

    await waitFor(() => expect(screen.getByText('Newest')).toBeTruthy());
    const titles = [...container.querySelectorAll('p.font-medium')].map((n) => n.textContent);
    expect(titles).toEqual(['Newest', 'Oldest']);
  });

  it('drops entries with no timestamp rather than rendering an Invalid Date', async () => {
    mockEndpoints({
      activities: [
        { id: 'ok', action: 'Has date', created_at: '2026-01-01T00:00:00Z' },
        { id: 'bad', action: 'No date' },
      ],
    });
    render(<ContactTimeline contactId="c1" />);

    await waitFor(() => expect(screen.getByText('Has date')).toBeTruthy());
    expect(screen.queryByText('No date')).toBeNull();
  });

  it('accepts the camelCase and alternate payload shapes', async () => {
    // The component reads data ?? activities, and created_at ?? createdAt.
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url.includes('activities')
            ? { activities: [{ id: 'a1', eventType: 'Imported', createdAt: '2026-01-01T00:00:00Z' }] }
            : { data: [] },
      })) as unknown as typeof fetch);

    render(<ContactTimeline contactId="c1" />);
    await waitFor(() => expect(screen.getByText('Imported')).toBeTruthy());
  });

  it('treats a failed endpoint as empty instead of breaking the timeline', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string) =>
      Promise.resolve(
        url.includes('calls')
          ? { ok: false, json: async () => ({}) }
          : { ok: true, json: async () => ({ data: [{ id: 'a1', action: 'Survived', created_at: '2026-01-01T00:00:00Z' }] }) }
      )) as unknown as typeof fetch);

    render(<ContactTimeline contactId="c1" />);
    // One source 500ing must not blank the whole panel.
    await waitFor(() => expect(screen.getByText('Survived')).toBeTruthy());
  });

  it('stops loading even when every request rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    render(<ContactTimeline contactId="c1" />);

    // The catch is followed by finally { setLoading(false) }, so the skeleton
    // must not be left on screen forever.
    await waitFor(() => {
      expect(screen.getByText('No interactions recorded yet.')).toBeTruthy();
    });
  });
});
