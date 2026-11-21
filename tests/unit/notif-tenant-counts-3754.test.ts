/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3754 — the notifications header must show tenant-wide counts from the API,
 * not the length of the current page's rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const api = readFileSync(join(root, 'app/api/tenant/notifications/route.ts'), 'utf8');
const page = readFileSync(join(root, 'app/tenant/notifications/page.tsx'), 'utf8');

describe('#3754 notifications tenant-wide counts', () => {
  it('the API returns a stable totalAll alongside total and unread', () => {
    expect(api).toContain('const [countResult, data, unreadCount, allCount]');
    expect(api).toContain('totalAll: allCount?.count ?? 0');
    expect(api).toContain('unread: unreadCount?.count ?? 0');
  });

  it('the page keys and requests by filter and uses server counts in the header', () => {
    expect(page).toContain("['tenant', 'notifications', { offset, filter }]");
    expect(page).toContain('&unread=${filter === \'unread\'}');
    expect(page).toContain('const unreadCount = failed ? 0 : (data?.unread ?? 0)');
    expect(page).toContain('const totalAll = failed ? 0 : (data?.totalAll ?? 0)');
    expect(page).toContain("{failed ? '—' : totalAll} total · {failed ? '—' : unreadCount} unread");
    expect(page).not.toContain('notifications.length} total');
  });

  it('changing the filter resets the offset', () => {
    expect(page).toContain("setFilter(v as 'all' | 'unread'); setOffset(0);");
  });
});
