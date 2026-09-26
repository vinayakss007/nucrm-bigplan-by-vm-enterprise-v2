import { describe, it, expect, vi } from 'vitest';

// Wave 10: malformed JSON must render as 400 on every route contract —
// v1 handleError(), the tenant/superadmin apiError() routes, and SCIM's
// application/scim+json errors — and must never reach the error_logs DB
// mirror or Sentry via logError().

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

describe('InvalidJsonBodyError handling (wave 10)', () => {
  it('v1 handleError maps it to a 400 ValidationError contract', async () => {
    const { handleError } = await import('@/lib/errors');
    const { InvalidJsonBodyError } = await import('@/lib/errors-shared');
    const res = handleError(new InvalidJsonBodyError(new SyntaxError('bad')));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
    expect(json.code).toBeDefined();
  });

  it('apiError renders 400 for it without a server-fault message', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { InvalidJsonBodyError } = await import('@/lib/errors-shared');
    const res = apiError(new InvalidJsonBodyError(new SyntaxError('bad')));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('readJsonBody throws it for a malformed body', async () => {
    const { readJsonBody } = await import('@/lib/api/validate');
    const { InvalidJsonBodyError } = await import('@/lib/errors-shared');
    const request = {
      json: async () => {
        throw new SyntaxError("Unexpected token 'z'");
      },
    } as unknown as Request;
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });
});
