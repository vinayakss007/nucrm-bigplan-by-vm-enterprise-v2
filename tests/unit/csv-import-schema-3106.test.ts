/**
 * #3106 — contacts/leads/deals CSV import validated against `importSchema`
 * ({entity_type, data[], mapping, skip_duplicates}) while every real caller —
 * `components/tenant/import-modal.tsx:93`, `components/tenant/lead-import-modal.tsx:89` —
 * posts `{ csv, skipDuplicates, updateExisting }`. `validateBody` runs `schema.parse`,
 * so the gate rejected the payload before a single row was parsed: every import
 * answered 400 "Validation failed", and the routes then read the csv off the RAW body
 * they had already discarded the validated form of.
 *
 * The suite hid this twice over: `postman/full-test-suite.sh` POSTs `{}` and asserts
 * 400 (right answer, wrong reason), and the existing route tests MOCK `validateBody`
 * away. This file does the opposite — it runs the real `validateBody` against the
 * real schema barrel, with nothing under `@/lib/api/validate` stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  parseContactsRows: [] as Array<Record<string, string>>,
  importOpts: undefined as unknown,
  importResults: { imported: 1, updated: 0, skipped: 0, errors: [] as string[] },
}));

// NOTE: '@/lib/api/validate' is deliberately NOT mocked — the real validateBody is
// the defect's site; stubbing it is what #3080's harness did and what hid this.
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ userId: 'u-1', tenantId: 't-1', email: 'a@b.com', isAdmin: true, isSuperAdmin: false }),
  requirePerm: () => null,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => Promise.resolve(null) }));
vi.mock('@/lib/audit', () => ({ logAudit: () => Promise.resolve() }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: async (_ctx: unknown, _entity: unknown, body: Record<string, unknown>) => ({ body, stripped: [] }),
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    transaction: async (cb: (tx: never) => unknown) => cb({} as never),
  },
}));
vi.mock('@/lib/import/contacts', () => ({
  MAX_IMPORT_ROWS: 10000,
  parseContactsCsv: () => h.parseContactsRows,
  processContactImport: vi.fn(async () => h.importResults),
}));

/** The exact shape the UI posts (import-modal.tsx:93): `{ csv, ...opts }`. */
function uiRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const UI_BODY_HEADER_ONLY = { csv: 'name,email\n', skipDuplicates: true, updateExisting: false };
const UI_BODY_ONE_ROW = { csv: 'name,email\nAda,ada@example.com', skipDuplicates: true, updateExisting: false };

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

describe("#3106 the UI's real payload reaches the CSV parser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.parseContactsRows = [];
    h.importOpts = undefined;
  });

  it('contacts: a header-only csv is refused by the PARSER, not the old importSchema gate', async () => {
    const { POST } = await import('@/app/api/tenant/contacts/import/route');
    const res = await POST(uiRequest('http://localhost/api/tenant/contacts/import', UI_BODY_HEADER_ONLY));
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error, `importSchema rejection leaked into the response: ${JSON.stringify(body)}`).toBe('No data rows found in CSV');
    expect(body).not.toHaveProperty('details');
  });

  it('contacts: a real csv row reaches the importer and forwards the parsed options', async () => {
    h.parseContactsRows = [{ name: 'Ada', email: 'ada@example.com' }];
    const { POST } = await import('@/app/api/tenant/contacts/import/route');
    const res = await POST(uiRequest('http://localhost/api/tenant/contacts/import', UI_BODY_ONE_ROW));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.ok).toBe(true);
    const { processContactImport } = await import('@/lib/import/contacts');
    expect(processContactImport).toHaveBeenCalledWith(
      't-1', 'u-1',
      [{ name: 'Ada', email: 'ada@example.com' }],
      expect.objectContaining({ skipDuplicates: true, updateExisting: false }),
    );
  });

  it('leads: a header-only csv is refused by the PARSER, not the old importSchema gate', async () => {
    const { POST } = await import('@/app/api/tenant/leads/import/route');
    const res = await POST(uiRequest('http://localhost/api/tenant/leads/import', UI_BODY_HEADER_ONLY));
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error, `importSchema rejection leaked into the response: ${JSON.stringify(body)}`).toBe('No data rows found in CSV');
  });

  it('deals: a header-only csv is refused by the PARSER, not the old importSchema gate', async () => {
    const { POST } = await import('@/app/api/tenant/deals/import/route');
    const res = await POST(uiRequest('http://localhost/api/tenant/deals/import', UI_BODY_HEADER_ONLY));
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error, `importSchema rejection leaked into the response: ${JSON.stringify(body)}`).toBe('No data rows found in CSV');
  });

  it('an empty csv is still refused — by the schema, before the parser', async () => {
    const { POST } = await import('@/app/api/tenant/contacts/import/route');
    const res = await POST(uiRequest('http://localhost/api/tenant/contacts/import', { ...UI_BODY_HEADER_ONLY, csv: '' }));
    expect(res.status).toBe(400);
  });

  it('the three routes share one csvImportSchema, exported from the barrel, that parses the UI shape', async () => {
    const barrel = await import('@/lib/api/schemas');
    const mod = await import('@/lib/api/schemas/import-export');
    expect(barrel.csvImportSchema).toBe(mod.csvImportSchema);
    const parsed = mod.csvImportSchema.parse({ csv: 'a\nb' });
    expect(parsed.skipDuplicates).toBe(true);
    expect(parsed.updateExisting).toBe(false);
    // The old gate still refuses the UI shape — that is the #3106 story, pinned here
    // so nobody "fixes" a route by pointing it back at importSchema.
    expect(() => mod.importSchema.parse(UI_BODY_ONE_ROW)).toThrow();
  });
});
