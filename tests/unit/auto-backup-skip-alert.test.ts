/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2127: orphan tenants must make the run LOUD (alert email + response
// field), not "green but silently incomplete".

const mockExecute = vi.fn();
vi.mock('@/drizzle/db', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (handler: unknown) => handler,
}));

const verifyCronSecretMock = vi.fn(async () => true);
vi.mock('@/lib/auth/cron', () => ({
  verifyCronSecret: (req: unknown) => verifyCronSecretMock(req),
}));

vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true })),
}));

vi.mock('@/lib/db/rls', () => ({
  setSuperAdminContext: vi.fn(async () => {}),
  setTenantContext: vi.fn(async () => {}),
}));

const sendAlertEmailMock = vi.fn(async () => {});
vi.mock('@/lib/email/alerts', () => ({
  sendAlertEmail: (subject: string, message: string) => sendAlertEmailMock(subject, message),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => {}),
}));

const exportAllMock = vi.fn(async () => ({
  dataSize: 1, tableCount: 1, totalRecords: 1, tables: {},
}));
vi.mock('@/lib/tenant-data-export', () => ({
  TenantDataExporter: vi.fn(function () {
    return { exportAll: exportAllMock };
  }),
}));

function sqlText(query: unknown): string {
  if (typeof query === 'string') return query;
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks.map((c) => {
    if (typeof c === 'string') return c;
    const v = (c as { value?: unknown })?.value;
    return Array.isArray(v) ? v.join('') : '';
  }).join('');
}

function rows(result: Record<string, unknown>[]) {
  return { rows: result };
}

describe('cron/auto-backup skip alerting (#2127)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('alerts and reports tenants skipped for having no usable identity', async () => {
    // Values are query parameters, not text, so the owner lookup is matched
    // by call order: first tenant (tenant-ok) has an owner, second is orphaned.
    let ownerCalls = 0;
    mockExecute.mockImplementation(async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes('FROM backup_schedules')) {
        return rows([{ id: 's1', tenant_id: null, schedule_type: 'daily', backup_type: 'full', retention_days: 90 }]);
      }
      if (text.includes('SELECT id FROM tenants')) {
        return rows([{ id: 'tenant-ok' }, { id: 'tenant-orphan' }]);
      }
      if (text.includes('owner_id FROM tenants')) {
        ownerCalls++;
        return rows(ownerCalls === 1 ? [{ owner_id: 'user-1' }] : []);
      }
      if (text.includes('tenant_members')) {
        return rows([]);
      }
      if (text.includes('INSERT INTO tenant_backup_records')) {
        return rows([{ id: 'b1' }]);
      }
      return rows([]);
    });

    const { POST } = await import('@/app/api/cron/auto-backup/route');
    const res = await POST({ headers: new Map() } as never);
    const body = await res.json();

    expect(body.scheduled.skipped).toBe(1);
    expect(body.scheduled.skippedTenants).toEqual(['tenant-orphan']);
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
    const [subject, message] = sendAlertEmailMock.mock.calls[0];
    expect(subject).toContain('1 tenant(s) skipped');
    expect(message).toContain('tenant-orphan');
  });

  it('stays quiet when nothing is skipped', async () => {
    mockExecute.mockImplementation(async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes('FROM backup_schedules')) {
        return rows([{ id: 's1', tenant_id: null, schedule_type: 'daily', backup_type: 'full', retention_days: 90 }]);
      }
      if (text.includes('SELECT id FROM tenants')) {
        return rows([{ id: 'tenant-ok' }]);
      }
      if (text.includes('owner_id FROM tenants')) {
        return rows([{ owner_id: 'user-1' }]);
      }
      if (text.includes('INSERT INTO tenant_backup_records')) {
        return rows([{ id: 'b1' }]);
      }
      return rows([]);
    });

    const { POST } = await import('@/app/api/cron/auto-backup/route');
    const res = await POST({ headers: new Map() } as never);
    const body = await res.json();

    expect(body.scheduled.skipped).toBe(0);
    expect(sendAlertEmailMock).not.toHaveBeenCalled();
    expect(exportAllMock).toHaveBeenCalledTimes(1);
  });
});
