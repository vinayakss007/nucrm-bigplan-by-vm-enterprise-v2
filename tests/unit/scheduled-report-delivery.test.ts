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

// Wrap the real renderReportPdf in a spy so tests can assert on real '%PDF-'
// bytes by default, yet still force a render failure to exercise the #1466
// retry-backoff path.
vi.mock('@/lib/pdf/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf/render')>();
  return {
    ...actual,
    renderReportPdf: vi.fn(actual.renderReportPdf),
  };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/cron/scheduled-report-delivery', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret' },
  }) as unknown as NextRequest;
}

describe('scheduled report delivery cron', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSelectResult.mockResolvedValue([]);
    mockUpdateWhere.mockResolvedValue([]);
    // clearAllMocks wipes the spy implementation; restore the real renderer so
    // PDF-format tests produce genuine '%PDF-' bytes unless a test overrides it.
    const actual = await vi.importActual<typeof import('@/lib/pdf/render')>('@/lib/pdf/render');
    const { renderReportPdf } = await import('@/lib/pdf/render');
    vi.mocked(renderReportPdf).mockImplementation(actual.renderReportPdf);
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
    const payload = mockSendEmail.mock.calls[0][0] as {
      to: string[];
      subject: string;
      text: string;
      html: string;
      attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
    };
    expect(payload.to).toEqual(['ops@acme.com', 'boss@acme.com']);
    expect(payload.subject).toContain('Weekly Contacts');

    // #1614: the CSV is delivered as a real .csv attachment whose bytes equal
    // the generated CSV — not inlined into an HTML <pre> block.
    expect(payload.attachments).toHaveLength(1);
    const csvAtt = payload.attachments![0];
    expect(csvAtt.filename).toBe('Weekly_Contacts.csv');
    expect(csvAtt.contentType).toBe('text/csv');
    expect(Buffer.isBuffer(csvAtt.content)).toBe(true);
    expect((csvAtt.content as Buffer).toString('utf8')).toBe('name,email\nAcme,acme@example.com');
    // No large CSV <pre> block remains in the HTML body.
    expect(payload.html).not.toContain('<pre');
    expect(payload.html).not.toContain('acme@example.com');

    // nextRunAt advanced + lastRunAt recorded
    expect(mockUpdateSet).toHaveBeenCalled();
    const setCall = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setCall).toHaveProperty('lastRunAt');
    expect(setCall).toHaveProperty('nextRunAt');
    expect(setCall.status).toBe('active');
  });

  it('attaches a real PDF file when the report format is pdf', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r-pdf',
      tenantId: 't1',
      name: 'Monthly Deals',
      type: 'deals',
      frequency: 'monthly',
      recipients: ['ops@acme.com'],
      format: 'pdf',
    }]);

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const payload = mockSendEmail.mock.calls[0][0] as {
      attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
    };
    expect(payload.attachments).toHaveLength(1);
    const pdfAtt = payload.attachments![0];
    expect(pdfAtt.filename).toBe('Monthly_Deals.pdf');
    expect(pdfAtt.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(pdfAtt.content)).toBe(true);
    // A valid PDF stream starts with the '%PDF-' magic bytes.
    expect((pdfAtt.content as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('releases the distributed lock in finally', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r-lock',
      tenantId: 't1',
      name: 'Lock Report',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com'],
      format: 'csv',
    }]);

    const { releaseLock } = await import('@/lib/cache');
    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(vi.mocked(releaseLock)).toHaveBeenCalledWith('cron:scheduled-report-delivery', 'lock-1');
  });

  it('routes a PDF-render failure through the retry-backoff failure path (#1466)', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r-pdf-fail',
      tenantId: 't1',
      name: 'Bad PDF',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com'],
      format: 'pdf',
      config: {},
    }]);

    // Force renderReportPdf to throw so the per-report try/catch must catch it.
    const { renderReportPdf } = await import('@/lib/pdf/render');
    vi.mocked(renderReportPdf).mockRejectedValueOnce(new Error('render exploded'));

    const { releaseLock } = await import('@/lib/cache');
    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    // No unhandled rejection: the cron still returns 200 and the failure-path
    // db.update runs (retry-backoff preserved), and the lock is still released.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(0);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      config: expect.objectContaining({ _failureCount: 1 }),
    }));
    expect(vi.mocked(releaseLock)).toHaveBeenCalledWith('cron:scheduled-report-delivery', 'lock-1');
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

  it('keeps a report active and counts the failure on a transient error (#1466)', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r3',
      tenantId: 't1',
      name: 'Broken',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com'],
      format: 'csv',
      config: {},
    }]);

    const { generateExportData } = await import('@/lib/export');
    vi.mocked(generateExportData).mockRejectedValueOnce(new Error('boom'));

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toBe(0);
    // A single transient failure must NOT permanently disable the report:
    // it stays 'active', nextRunAt is advanced, and the failure is counted.
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      config: expect.objectContaining({ _failureCount: 1 }),
    }));
  });

  it('disables a report only after repeated consecutive failures (#1466)', async () => {
    mockSelectResult.mockResolvedValue([{
      id: 'r3b',
      tenantId: 't1',
      name: 'Chronically Broken',
      type: 'contacts',
      frequency: 'daily',
      recipients: ['ops@acme.com'],
      format: 'csv',
      config: { _failureCount: 4 }, // 5th consecutive failure -> give up
    }]);

    const { generateExportData } = await import('@/lib/export');
    vi.mocked(generateExportData).mockRejectedValueOnce(new Error('boom'));

    const { POST } = await import('@/app/api/cron/scheduled-report-delivery/route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      config: expect.objectContaining({ _failureCount: 5 }),
    }));
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