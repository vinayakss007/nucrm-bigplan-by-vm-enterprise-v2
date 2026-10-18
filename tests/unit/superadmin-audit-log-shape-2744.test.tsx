// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2744 — the platform audit log renders nothing, and its CSV export throws.
 *
 * `components/superadmin/audit-log-client.tsx:32-50` declares `AuditLogEntry` in
 * snake_case (`admin_email`, `target_type`, `old_data`, `created_at`, …) and
 * `:139-141` fills it from `GET /api/super-admin/audit-logs`, which is a raw
 * `db.select().from(superAdminAuditLogs)` (`app/api/super-admin/audit-logs/route.ts:126-132`)
 * — Drizzle's own camelCase keys (`adminEmail`, `targetType`, `oldData`,
 * `createdAt`, per `drizzle/schema/super-admin-audit.ts:8-34`). `AuditLogResponse`
 * is a cast, not a conversion.
 *
 * So for every row: the "who" cell (`:319`) renders nothing at all, target type
 * (`:309`) prints `—`, the target name (`:310`) and id (`:313`) blocks never
 * mount, tenant and IP (`:320-321`) never mount, and `hasDetail` (`:296`) is
 * permanently false because `old_data`/`new_data` are `undefined` — the
 * before/after diff that is the entire point of an audit row cannot be opened.
 * `toCSV:77` calls `new Date(undefined).toISOString()`, which throws
 * `RangeError: Invalid time value`, so **Export CSV** silently produces no file.
 *
 * `action`, `id` and the payload's `total`/`limit`/`offset` do line up, so the
 * action dropdown and the row count still work — those are the controls here, and
 * they are why the page looks healthy instead of broken.
 *
 * Addresses use the RFC 5737/3849 documentation ranges on purpose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

import AuditLogClient from '@/components/superadmin/audit-log-client';

const CREATED_AT = new Date(Date.now() - 3 * 86400000).toISOString();

/** One row exactly as route.ts:126-132 answers it (raw table select). */
function apiRow(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    adminId: '22222222-2222-4222-8222-222222222222',
    adminEmail: 'root@corp.test',
    action: 'tenant_impersonation_started',
    targetType: 'tenant',
    targetId: '33333333-3333-4333-8333-333333333333',
    targetName: 'Acme Dashboard',
    tenantId: '44444444-4444-4444-8444-444444444444',
    tenantName: 'Acme Analytics',
    ipAddress: '2001:db8::42',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    oldData: '{"status":"active"}',
    newData: '{"status":"trialing"}',
    metadata: null,
    previousHash: 'aa00',
    hash: 'bb11',
    createdAt: CREATED_AT,
    ...over,
  };
}

function stubFetch(rows: Record<string, unknown>[], total = rows.length) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: rows, total, limit: 50, offset: 0 }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let capturedBlob: Blob | undefined;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  capturedBlob = undefined;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, writable: true,
    value: (b: Blob) => { capturedBlob = b; return 'blob:mock'; },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

async function mount(rows: Record<string, unknown>[], total = rows.length) {
  stubFetch(rows, total);
  render(<AuditLogClient />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('the platform audit log reads the keys the route returns (#2744)', () => {
  it('names the admin who acted', async () => {
    await mount([apiRow()]);
    expect(screen.getAllByText('root@corp.test').length).toBeGreaterThan(0);
  });

  it('shows what was targeted', async () => {
    await mount([apiRow()]);
    // Scoped to the row: the "All targets" <select> offers a `tenant` option of
    // its own, and the cell is `capitalize`-styled, so its DOM text stays the
    // raw slug.
    const row = document.querySelector('div[class*="hover:bg-accent"]');
    expect(row, 'no rows rendered at all').toBeTruthy();
    expect(within(row as HTMLElement).getByText('tenant')).toBeTruthy();
    expect(within(row as HTMLElement).getByText('Acme Dashboard')).toBeTruthy();
    expect(within(row as HTMLElement).getByText(/33333333…/)).toBeTruthy();
  });

  it('shows the tenant and the source address', async () => {
    await mount([apiRow({ tenantName: 'Northwind Labs' })]);
    expect(document.body.textContent).toContain('Northwind Labs');
    expect(document.body.textContent).toContain('2001:db8::42');
  });

  it('lets the row be opened to its before/after diff', async () => {
    await mount([apiRow()]);
    // The action label also appears as a <select> option above the list, so take
    // the last match — the rows come after the filters in the DOM.
    const label = screen.getAllByText('tenant impersonation started').pop()!;
    const row = label.closest('div[class*="hover:bg-accent"]');
    expect(row, 'no expandable row means hasDetail never fired').toBeTruthy();
    fireEvent.click(row!);
    await waitFor(() => expect(screen.getByText('Before')).toBeTruthy());
    expect(screen.getByText('After')).toBeTruthy();
    expect(document.body.textContent).toContain('"status": "active"');
    expect(document.body.textContent).toContain('"status": "trialing"');
  });

  it('shows when it happened, not an invalid date', async () => {
    await mount([apiRow()]);
    // formatRelativeTime is terse: three days is "3d ago" (lib/utils.ts:60-66).
    expect(screen.getByText(/3d ago/)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('Invalid Date');
  });

  it('exports the audit trail as CSV instead of throwing', async () => {
    await mount([apiRow()]);
    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() => expect(capturedBlob).toBeTruthy());
    const csv = await capturedBlob!.text();
    expect(csv).toContain('root@corp.test');
    expect(csv).toContain(CREATED_AT);
    expect(csv).toContain('2001:db8::42');
  });

  // Controls — the fields that already line up, so the page looks healthy.
  it('the action filter is still populated from `action`', async () => {
    await mount([
      apiRow({ id: '11111111-1111-4111-8111-111111111111', action: 'tenant_impersonation_started' }),
      apiRow({ id: '55555555-5555-4555-8555-555555555555', action: 'api_key_revoked' }),
    ]);
    const select = screen.getAllByRole('combobox')[0]!;
    const options = Array.from(select.querySelectorAll('option')).map(o => o.value).filter(Boolean);
    expect(options).toEqual(['api_key_revoked', 'tenant_impersonation_started']);
  });

  it('the pagination still counts the total the route reports', async () => {
    await mount([apiRow()], 120);
    expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
    expect(screen.getByText(/120 events/)).toBeTruthy();
  });
});
