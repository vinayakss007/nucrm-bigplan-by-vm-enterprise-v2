// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NextRequest, NextResponse } from 'next/server';

/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2881 — the development dashboard page, rendered against the handlers it polls.
 *
 * `tests/unit/dev-dashboard-routes-2881.test.ts` proves each handler answers its URL.
 * That is half the contract; the other half is that the page reads the answer. This
 * file mounts `app/dev/dashboard/page.tsx` for real, points its `fetch` at the four
 * route handlers, and asserts the panels draw rows — the Overview cards off the
 * dashboard response, and one row per tab off the three endpoints whose handlers were
 * never routed.
 *
 * It exists because of the second half of the bug: the dashboard GET has never
 * returned `uptime`, `nodeVersion` or `memory`, and `page.tsx:253` reads
 * `data.memory.rss` bare. So even after the three 404s were fixed, the default tab
 * threw on first render and the dashboard drew nothing at all. A handler test cannot
 * see that; a render can.
 *
 *   Measured on `main` (86f92769): without the branch's handlers this file never
 *   collects (`Cannot find package '@/app/api/dev/logs/route'`). With them, but the
 *   dashboard route left at its base version, all three tests fail on
 *   `Unable to find an element with the text: Memory RSS` — the throw at `page.tsx:253`.
 *   With the branch applied, 40/40 across this file and the two unit files.
 */

const USER = 'a1111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  userRows: [] as Array<{ id: string; isSuperAdmin: boolean }>,
  logs: { requests: [] as unknown[], queries: [] as unknown[], errors: [] as unknown[] },
}));

const mockGetCurrentUserForToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/session', () => ({ getCurrentUserForToken: mockGetCurrentUserForToken }));
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(state.userRows) }) }),
    }),
    execute: () => Promise.resolve({ rows: [{ count: '512' }] }),
  },
}));
vi.mock('@/lib/dev-logger', () => ({
  devLogger: {
    getStats: () => ({
      uptime: '12.34 min',
      totalRequests: 1,
      totalErrors: 1,
      errorRate: '100.00%',
      avgResponseTime: '12ms',
      avgQueryTime: '250ms',
      totalQueries: 1,
      slowQueries: 1,
    }),
    exportLogs: () => ({
      timestamp: new Date().toISOString(),
      stats: {},
      requests: state.logs.requests,
      queries: state.logs.queries,
      errors: state.logs.errors,
    }),
    clear: () => undefined,
  },
}));

/* vitest hoists the mocks above, so these imports see the fakes. */
import { GET as getLogs } from '@/app/api/dev/logs/route';
import { GET as getQueries } from '@/app/api/dev/queries/route';
import { GET as getErrors } from '@/app/api/dev/errors/route';
import { GET as getDashboard } from '@/app/api/dev/dashboard/route';
import DevelopmentDashboard from '@/app/dev/dashboard/page';
import { makeQueryClient } from '@/lib/query/client';

type Handler = (req: NextRequest) => Promise<NextResponse>;

/** URL the page asks for → the handler that answers it. */
const ROUTES: Record<string, Handler> = {
  '/api/dev/dashboard': getDashboard,
  '/api/dev/logs': getLogs,
  '/api/dev/queries': getQueries,
  '/api/dev/errors': getErrors,
};

const REQUESTS = [
  { method: 'GET', path: '/api/v1/contacts', status: 200, duration: 12, timestamp: 1_700_000_000_000 },
];
const QUERIES = [
  { sql: 'select * from contacts where tenant_id = $1', duration: 250, timestamp: 1_700_000_000_000 },
];
const ERRORS = [
  {
    message: 'tenant context missing',
    context: 'contacts/list',
    timestamp: 1_700_000_000_000,
    stack: 'at Contacts',
  },
];

/** Hand each named URL to its handler; anything else keeps 404ing like the bug did. */
function serve(answers: Record<string, Handler> = ROUTES) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = new URL(String(input), 'http://nucrm.test');
    const handler = answers[url.pathname];
    if (!handler) return Response.json({ error: 'Not found' }, { status: 404 });
    const req = new NextRequest(url.toString());
    req.cookies.set('nucrm_session', 'a.jwt.token');
    // the body is read out of the handler's response and re-served, because
    // `apiFetcher` calls `res.json()` on it and a consumed body would throw
    const res = await handler(req);
    const body = await res.json();
    return Response.json(body, { status: res.status });
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <DevelopmentDashboard />
    </QueryClientProvider>,
  );
}

/** page.tsx:112 holds the spinner up until all four queries report. */
const settled = () => waitFor(() => expect(screen.queryByText('Loading dashboard...')).toBeNull());

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  state.userRows = [{ id: USER, isSuperAdmin: true }];
  state.logs = { requests: REQUESTS, queries: QUERIES, errors: ERRORS };
  mockGetCurrentUserForToken.mockImplementation(async () => ({ id: USER }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the dashboard page draws what its four endpoints answer (#2881)', () => {
  it('renders the Overview tab instead of throwing on the fields it reads bare', async () => {
    serve();
    renderPage();
    await settled();

    // `data.memory.rss` at page.tsx:253 is a bare property read of what used to be an
    // absent object, so this is the assertion the old response could not pass
    expect(screen.getByText('Memory RSS')).toBeTruthy();
    expect(screen.getByText('Total Requests')).toBeTruthy();
    expect(screen.getByText('DB Connections')).toBeTruthy();
    expect(screen.getByText(/Node\.js v\d+\./)).toBeTruthy();
    // the Recent Requests list on this tab is fed by /api/dev/logs
    expect(screen.getByText('/api/v1/contacts')).toBeTruthy();
  });

  it('fills the Requests, Queries and Errors tabs from the three endpoints that were never routed', async () => {
    serve();
    renderPage();
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'Queries' }));
    // `slow=true` is what page.tsx:78 sends, and the fixture is over the 100ms threshold
    await waitFor(() =>
      expect(screen.getByText(/select \* from contacts where tenant_id/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(screen.getByText('tenant context missing')).toBeTruthy());
    // the tab renders `err.stack` (page.tsx:394); the handler this replaced dropped it
    expect(screen.getByText('at Contacts')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    await waitFor(() => expect(screen.getByText('/api/v1/contacts')).toBeTruthy());
  });

  it('leaves the Overview standing when the three panels are not answered (control)', async () => {
    // so the test above cannot be passing because the panels are simply never drawn:
    // with only the dashboard answering, Overview still renders and Errors stays
    // empty — which is the state #2881 left the page in, from the other side
    serve({ '/api/dev/dashboard': getDashboard });
    renderPage();
    await settled();

    expect(screen.getByText('Memory RSS')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    expect(screen.queryByText('tenant context missing')).toBeNull();
  });
});
