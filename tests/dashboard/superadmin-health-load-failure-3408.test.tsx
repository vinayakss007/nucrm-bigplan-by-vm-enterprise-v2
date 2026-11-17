// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3408 — the superadmin health panel used to derive its badge from an empty
 * array when the health fetch failed: `[].every(...) === true`, so an API
 * outage rendered a green "ALL UP". These tests drive the real component with
 * stubbed responses and assert the badge says what actually happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SuperAdminDashboardClient from '@/components/superadmin/superadmin-dashboard-client';

vi.mock('@/lib/errors-client', () => ({ logError: vi.fn() }));

const HEALTH_URL = '/api/superadmin/health';
const checks = [
  { service: 'database', status: 'up', latency_ms: 3, message: 'Connected' },
  { service: 'app', status: 'up', latency_ms: 0, message: 'Node v24' },
  { service: 'email', status: 'up', latency_ms: 12, message: 'OK' },
  { service: 'object_storage', status: 'up', latency_ms: 4, message: 'OK' },
];

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const json = (body: unknown, ok = true, status = 200): FakeResponse => ({
  ok, status, json: async () => body,
});

/** Stub all four panel fetches; only the health one varies per case. */
function stubFetch(health: FakeResponse | Error): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith(HEALTH_URL)) {
      if (health instanceof Error) throw health;
      return health as Response;
    }
    return json({}) as Response;
  });
}

function renderDashboard() {
  return render(
    <SuperAdminDashboardClient
      stats={{}}
      recentTenants={[]}
      recentErrors={[]}
      expiringSoon={[]}
      userName="Admin"
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: superadmin health panel does not report "ALL UP" on a failed load', () => {
  it('an HTTP 500 with an error body shows UNAVAILABLE, not ALL UP', async () => {
    stubFetch(json({ error: 'Internal server error' }, false, 500));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('UNAVAILABLE')).toBeTruthy());
    expect(screen.queryByText('ALL UP')).toBeNull();
    expect(screen.getByText('Could not load health data')).toBeTruthy();
  });

  it('a failure envelope inside a 200 is also treated as a failed load', async () => {
    stubFetch(json({ ok: false, error: { code: 'HEALTH_FAILED', message: 'probe down' } }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('UNAVAILABLE')).toBeTruthy());
    expect(screen.queryByText('ALL UP')).toBeNull();
  });

  it('a network rejection shows UNAVAILABLE instead of staying green', async () => {
    stubFetch(new Error('Network down'));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('UNAVAILABLE')).toBeTruthy());
    expect(screen.queryByText('ALL UP')).toBeNull();
  });

  it('a missing checks array is not silently reported as ALL UP', async () => {
    stubFetch(json({ history: [] }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('UNAVAILABLE')).toBeTruthy());
    expect(screen.queryByText('ALL UP')).toBeNull();
  });

  it('a genuinely healthy response still shows ALL UP with its checks', async () => {
    stubFetch(json({ checks }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('ALL UP')).toBeTruthy());
    expect(screen.getByText('database')).toBeTruthy();
    expect(screen.queryByText('UNAVAILABLE')).toBeNull();
  });

  it('a genuinely down component still shows ISSUES', async () => {
    stubFetch(json({ checks: checks.map((c, i) => i === 0 ? { ...c, status: 'down' } : c) }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText('ISSUES')).toBeTruthy());
    expect(screen.queryByText('ALL UP')).toBeNull();
  });
});
