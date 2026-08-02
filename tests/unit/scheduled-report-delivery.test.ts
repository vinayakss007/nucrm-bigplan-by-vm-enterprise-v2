import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockSelectResult = vi.fn().mockResolvedValue([]);
const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectResult });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockUpdateWhere = vi.fn().mockResolvedValue([]);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockSendEmail = vi.fn().mockResolvedValue({ success: true });
const mockLock = { acquired: true, value: 'lock-1' };

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
    update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  scheduledReports: {
    id: 'id',
    tenantId: 'tenant_id',
    name: 'name',
    type: 'type',
    frequency: 'frequency',
    recipients: 'recipients',
    format: 'format',
    status: 'status',
    deletedAt: 'deleted_at',
    nextRunAt: 'next_run_at',
    lastRunAt: 'last_run_at',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
  isNull: vi.fn(() => true),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => `SQL(${values.join(',')})`),
}));

vi.mock('@/lib/crypto', () => ({
  verifySecret: vi.fn(() => true),
}));

vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn().mockResolvedValue(mockLock),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/export', () => ({
  generateExportData: vi.fn().mockResolvedValue('name,email\nAcme,acme@example.com'),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/scheduled-report-delivery', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('scheduled report delivery cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.mockResolvedValue([]);
    mockUpdateWhere.mockResolvedValue([]);
  });

  it('rejects requests without a valid cron secret', async () => {
    const { verifySecret } = await import('@/lib/crypto');
    vi.mocked(verifySecret).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const req = new Request('http://localhost/api/cron/scheduled-report-delivery', {
      method: 'POST',
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('generates a CSV and emails recipients for due reports', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r1',
      tenantId: 't1',
      name: 'Weekly Contacts',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com', 'boss@acme.com'],
      format: 'csv',
    }]);

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(1);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const payload = mockSendEmail.mock.calls[0][0] as { to: string[]; subject: string; text: string };
    expect(payload.to).toEqual(['ops@acme.com', 'boss@acme.com']);
    expect(payload.subject).toContain('Weekly Contacts');
    expect(payload.text).toContain('Acme');

    // nextRunAt advanced + lastRunAt recorded
    expect(mockUpdateSet).toHaveBeenCalled();
    const setCall = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setCall).toHaveProperty('lastRunAt');
    expect(setCall).toHaveProperty('nextRunAt');
    expect(setCall.status).toBe('active');
  });

  it('does not send an email when recipients are missing', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r2',
      tenantId: 't2',
      name: 'Empty Recipients',
      type: 'deals',
      frequency: 'weekly',
      recipients: [],
      format: 'csv',
    }]);

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('marks a report as error when generation or send fails', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r3',
      tenantId: 't1',
      name: 'Broken',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com'],
      format: 'csv',
    }]);

    const { generateExportData } = await import('@/lib/export');
    vi.mocked(generateExportData).mockRejectedValueOnce(new Error('boom'));

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('skips when another instance holds the lock', async () => {
    const { acquireLock } = await import('@/lib/cache');
    vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, value: '' });

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(mockSelectResult).not.toHaveBeenCalled();
  });
});