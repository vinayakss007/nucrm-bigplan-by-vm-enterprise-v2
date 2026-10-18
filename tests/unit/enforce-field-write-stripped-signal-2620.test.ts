/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { attachStrippedFields } from '@/lib/rbac/enforce';

// #2620 — enforceFieldWrite strips restricted keys ("STRIP, not 403") but
// every call site was discarding the returned `stripped` array, so a rep whose
// PATCH lost an `amount` write got 200 OK with zero signal. The helper is now
// the single place handlers use to surface what was dropped, and the tests
// below pin that it's a header-only, no-op-when-empty side effect so it can't
// accidentally regress response shape for unrestricted callers.
describe('attachStrippedFields (#2620)', () => {
  it('sets X-Stripped-Fields to the comma-joined list when non-empty', () => {
    const res = attachStrippedFields(NextResponse.json({ data: { id: '1' } }), ['amount', 'commission']);
    expect(res.headers.get('X-Stripped-Fields')).toBe('amount,commission');
  });

  it('does NOT add the header when stripped is empty (unrestricted callers unchanged)', () => {
    const res = attachStrippedFields(NextResponse.json({ data: { id: '1' } }), []);
    expect(res.headers.get('X-Stripped-Fields')).toBeNull();
  });

  it('preserves body, status and content-type through the wrapper', async () => {
    const res = attachStrippedFields(NextResponse.json({ ok: true }, { status: 201 }), ['amount']);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('handles a single stripped field', () => {
    const res = attachStrippedFields(NextResponse.json({}), ['value']);
    expect(res.headers.get('X-Stripped-Fields')).toBe('value');
  });
});
