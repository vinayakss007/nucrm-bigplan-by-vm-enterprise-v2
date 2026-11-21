/**
 * #3408 — the legacy-error-body ratchet must fail on a NEW emitter or a
 * growing one, and ratchet down cleanly as handlers move to the canonical
 * envelope. Mirrors tests/unit/client-fetch-guard-3408.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  countLegacyErrorBodies,
  checkApiEnvelope,
} from '../../scripts/check-api-envelope.mjs';

describe('api-envelope guard (#3408)', () => {
  it('counts only bare error string bodies, never the canonical envelope', () => {
    expect(countLegacyErrorBodies(
      'NextResponse.json({ error: "Not found" }, { status: 404 });',
    )).toBe(1);
    expect(countLegacyErrorBodies(
      "json({ error: 'bad' });\nreturn json({ error: `worse` });",
    )).toBe(2);
    // Canonical and structured failures are the target shape, not the legacy one.
    expect(countLegacyErrorBodies(
      "json({ ok: false, error: { code: 'E', message: 'bad' } });",
    )).toBe(0);
    expect(countLegacyErrorBodies('json({ data: [] });')).toBe(0);
  });

  it('passes when every emitter is pinned at its current count', () => {
    const files = ['app/api/a/route.ts', 'app/api/b/route.ts'];
    const read = (f: string) => f === 'app/api/a/route.ts'
      ? "json({ error: 'nope' });" : 'json({ ok: true, data: [] });';
    expect(checkApiEnvelope(files, read, { 'app/api/a/route.ts': 1 })).toEqual([]);
  });

  it('fails when a route adds a bare error body without a ledger entry', () => {
    const problems = checkApiEnvelope(
      ['app/api/new/route.ts'],
      () => "json({ error: 'boom' });",
      {},
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not in scripts/api-envelope-ledger.json');
  });

  it('fails when a pinned route grows its legacy surface', () => {
    const problems = checkApiEnvelope(
      ['app/api/a/route.ts'],
      () => "json({ error: 'a' });\njson({ error: 'b' });",
      { 'app/api/a/route.ts': 1 },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('grew from 1 to 2');
  });

  it('allows a route to shrink but demands removal of a fully migrated entry', () => {
    const read = () => "json({ error: 'a' });";
    expect(checkApiEnvelope(['app/api/a/route.ts'], read, { 'app/api/a/route.ts': 3 })).toEqual([]);
    const problems = checkApiEnvelope(
      ['app/api/a/route.ts'],
      () => 'json({ ok: true, data: [] });',
      { 'app/api/a/route.ts': 1 },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer emits a bare error body');
  });
});
