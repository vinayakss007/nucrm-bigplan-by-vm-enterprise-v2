// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2808 — `components/tenant/tasks-data-table.tsx` read a `contact_name` key that
 * `GET /api/tenant/tasks` does not return.
 *
 * The route projects each row by hand (`app/api/tenant/tasks/route.ts:79-99`) and
 * the related contact arrives as a pair — `first_name` and `last_name` (`:94-95`)
 * — under a comment that calls those names the frontend contract (`:78`). Two of
 * the three UIs on this endpoint read exactly that pair
 * (`components/tenant/tasks-client.tsx:26-27`, rendered at `:269`;
 * `app/tenant/tasks/kanban/kanban-client.tsx:35-36`, joined for display at `:71`).
 * The third declared `contact_name` (`:43`), used it as the column's
 * `accessorKey` (`:229`) and read it in the cell (`:232`) — a key the route has
 * never emitted.
 *
 * It appeared to work because the server page synthesises that key for the first
 * render (`app/tenant/tasks/page.tsx:96`, added under #1341). `loadData()`
 * (`:82-97`) then replaces the whole list with the route's rows —
 * `setTasks(data.data ?? [])` — and it runs on pagination (`:104`), on search
 * (`:113`), after a create (`:153`) and after a bulk action (`:333`). From that
 * point on every contact-linked task renders the cell's fallback
 * (`:236`: `contact ? `👤 ${contact}` : deal ? `💼 ${deal}` : '—'`), so the
 * contact quietly turns into a deal or an em dash. `deal_title` and
 * `assignee_name` survived the swap because they *are* route keys (`:96-97`) —
 * only the contact column was page-invented, which is why nobody noticed.
 *
 * The fix is therefore on the consumer side, mirroring the kanban: derive the
 * display name from the pair, and let the page pass the same pair instead of a
 * third shape. Tests below feed the component rows shaped exactly as the route
 * returns them, including through the refetch that the page currently masks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import TasksDataTable from '@/components/tenant/tasks-data-table';

const PERMISSIONS = { canCreate: true, canEdit: true, canDelete: true, canAssign: true };

/** A row exactly as `route.ts:79-99` serialises it — note the absence of
 *  `contact_name`, which is the whole subject of this file. */
function apiTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Send the proposal',
    description: null,
    priority: 'high',
    status: 'pending',
    completed: false,
    due_date: '2026-02-01T00:00:00.000Z',
    completed_at: null,
    contact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    deal_id: null,
    assigned_to: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    created_at: '2026-01-10T09:00:00.000Z',
    first_name: 'Dana',
    last_name: 'Whitfield',
    deal_title: null,
    assignee_name: 'Ravi Kumar',
    ...overrides,
  };
}

function stubTasksFetch(rows: unknown[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: rows, total: rows.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

function renderTable(initialTasks: unknown[]) {
  return render(
    <TasksDataTable
      initialTasks={initialTasks as never}
      contacts={[]}
      deals={[]}
      teamMembers={[]}
      permissions={PERMISSIONS}
    />,
  );
}

/** The rendered body as one string. Asserted against text rather than against a
 *  node reference: the table re-renders on every `setTasks`, and a node held
 *  across an `await` can be detached by the time it is asserted. */
const bodyText = () => String(document.body.textContent);

describe('#2808 — the tasks table names the contact from the fields the API sends', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the contact for rows shaped the way the route shapes them', async () => {
    stubTasksFetch([apiTask()]);
    renderTable([apiTask()]);

    await waitFor(() => expect(bodyText()).toContain('Send the proposal'));
    expect(bodyText()).toContain('👤 Dana Whitfield');
  });

  it('keeps showing it after loadData replaces the list, which is where it used to vanish', async () => {
    // Seed, then a search commits and `setTasks` swaps in the route's own rows:
    // the two shapes used to differ, which is what this case pins down.
    stubTasksFetch([apiTask({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Call them back' })]);
    renderTable([apiTask()]);

    await waitFor(() => expect(bodyText()).toContain('Dana Whitfield'));

    fireEvent.change(screen.getByLabelText('Search tasks by title, contact, or deal...'), {
      target: { value: 'call' },
    });

    await waitFor(() => expect(bodyText()).toContain('Call them back'));
    expect(bodyText()).toContain('👤 Dana Whitfield');
  });

  it('still prefers the deal when the task is linked to one and has no contact', async () => {
    const row = apiTask({ first_name: null, last_name: null, contact_id: null, deal_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', deal_title: 'Acme renewal' });
    stubTasksFetch([row]);
    renderTable([row]);

    await waitFor(() => expect(bodyText()).toContain('Send the proposal'));
    expect(bodyText()).toContain('💼 Acme renewal');
  });

  it('shows the em dash rather than an empty label when there is neither', async () => {
    const row = apiTask({ first_name: null, last_name: null, contact_id: null, deal_id: null, deal_title: null });
    stubTasksFetch([row]);
    renderTable([row]);

    await waitFor(() => expect(bodyText()).toContain('Send the proposal'));
    // The due date renders an em dash too, so count the cell's own marker: the
    // row must show exactly the two dashes the fallbacks produce, no `👤`.
    expect(bodyText()).not.toContain('👤');
    expect(bodyText()).toContain('—');
  });
});
