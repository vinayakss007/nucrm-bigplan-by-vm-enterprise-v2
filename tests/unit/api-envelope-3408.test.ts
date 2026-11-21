/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 PR-5B — the one HTTP response envelope.
 *
 * The server and the client must agree on the same closed shape. These tests
 * pin the constructors, the type guards, and the contract with the shared
 * client's failure recogniser: a failure emitted by withApiRoute must be a
 * failure to apiFetcher, while a genuine empty success stays data.
 */
import { describe, it, expect } from 'vitest';
import {
  apiOk,
  apiFail,
  isApiFailure,
  isApiSuccess,
  type ApiEnvelope,
} from '@/lib/api/api-envelope';
import { failureFromBody } from '@/lib/query/client';

describe('#3408 canonical API envelope', () => {
  it('success is { ok: true, data }', () => {
    expect(apiOk({ id: '1' })).toEqual({ ok: true, data: { id: '1' } });
  });

  it('failure is { ok: false, error: { code, message } }', () => {
    expect(apiFail('POOL_SATURATED', 'try again')).toEqual({
      ok: false,
      error: { code: 'POOL_SATURATED', message: 'try again' },
    });
  });

  it('carries optional details only when given, never an undefined key', () => {
    expect(apiFail('VALIDATION', 'bad', { field: 'amount' })).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'bad', details: { field: 'amount' } },
    });
    expect(Object.keys(apiFail('X', 'y').error)).toEqual(['code', 'message']);
  });

  it('is a closed union — ok is the discriminant', () => {
    const responses: ApiEnvelope<number>[] = [apiOk(1), apiFail('E', 'no')];
    expect(responses.map(r => r.ok)).toEqual([true, false]);
  });
});

describe('#3408 envelope type guards', () => {
  it('accepts the canonical shapes', () => {
    expect(isApiSuccess(apiOk([]))).toBe(true);
    expect(isApiFailure(apiFail('E', 'no'))).toBe(true);
  });

  it('rejects the legacy shapes so a migration cannot confuse them', () => {
    expect(isApiFailure({ error: 'bare string' })).toBe(false);
    expect(isApiFailure({ success: false, error: 'legacy' })).toBe(false);
    expect(isApiFailure({ ok: false, error: 'not structured' })).toBe(false);
    expect(isApiSuccess({ data: [] })).toBe(false);
    expect(isApiSuccess(null)).toBe(false);
  });
});

describe('#3408 server envelope is understood by the shared client', () => {
  it('failureFromBody reads the canonical failure and keeps its code', () => {
    const body = apiFail('DB_CLIENT_ERROR', 'Invalid reference');
    expect(failureFromBody(body, 400)).toEqual({
      shape: 'error-object',
      message: 'Invalid reference',
      code: 'DB_CLIENT_ERROR',
    });
  });

  it('an empty success envelope stays data', () => {
    expect(failureFromBody(apiOk([]), 200)).toBeNull();
  });
});
