/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The #2825 guard tested against sources, not just against the tree.
 *
 * A screen like this fails in one direction only: a regex that stops matching
 * prints "OK". So each offender shape is planted and must be named with its
 * line, and each honest shape must not be — including the ones a sloppier
 * screen would flag and the maintainers would then delete.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeFiles, ALLOW, EMPTY_PAYLOAD, objectLiteral, scan, scanSource } from '../../scripts/check-catch-empty.mjs';

describe('catch-empty guard (#2825) — offenders', () => {
  it('names the payload shape that started the issue', () => {
    const src = `
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}`;
    const found = scanSource('app/api/x/route.ts', src);
    expect(found).toHaveLength(1);
    expect(found[0].line, 'pointed at the wrong line').toBe(5);
    expect(found[0].payload).toContain('data: []');
  });

  it('names ok:true, an empty object, results:[] and a nested catch', () => {
    const cases = [
      'catch (err) { return NextResponse.json({ ok: true }); }',
      'catch { return NextResponse.json({}); }',
      'catch { return NextResponse.json({ results: [] }); }',
      'catch { try { log() } catch { return NextResponse.json({ rows: [] }); } }',
    ];
    for (const body of cases) {
      const found = scanSource('app/api/y/route.ts', `async function h() {\n  ${body}\n}`);
      expect(found, body).toHaveLength(1);
    }
  });

  it('does not confuse a 2xx status written out with an honest failure', () => {
    const found = scanSource('app/api/z/route.ts', 'catch { return NextResponse.json({ data: [] }, { status: 200 }); }');
    expect(found).toHaveLength(1);
  });
});

describe('catch-empty guard (#2825) — honest shapes it must not flag', () => {
  const clean = [
    // the #2439 / #2825 response this guard asks for
    'catch (err) { void logError({ error: err }); return NextResponse.json({ error: "Failed to load quotes" }, { status: 500 }); }',
    // a 4xx with an empty payload is still a refusal, not a result
    'catch { return NextResponse.json({ data: [] }, { status: 404 }); }',
    // real rows, and a rethrow
    'catch { return NextResponse.json({ data: rows }); }',
    'catch (err) { throw err; }',
    // the malformed-body 400s that make up most of the tree's catch blocks
    'catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }',
    // a non-NextResponse helper
    'catch (err) { return apiError(err); }',
  ];
  for (const body of clean) {
    it(body.slice(0, 60), () => {
      expect(scanSource('app/api/c/route.ts', `async function h() {\n  ${body}\n}`)).toEqual([]);
    });
  }

  it('reads the payload of the response, not of a later call in the same block', () => {
    const src = `async function h() {
  try { doIt(); } catch (err) {
    notify({ data: [] });
    return NextResponse.json({ error: 'no' }, { status: 500 });
  }
}`;
    expect(scanSource('app/api/d/route.ts', src)).toEqual([]);
  });
});

describe('the guard against the real tree (#2825)', () => {
  it('is not vacuous: the regex, the brace matcher and the walker each work', () => {
    expect(EMPTY_PAYLOAD.test('{ data: [] }')).toBe(true);
    expect(objectLiteral('{ a: { b: 1 } } rest', 0)).toBe('{ a: { b: 1 } }');
    expect(objectLiteral('{ never closed', 0)).toBeNull();
    const files = [...routeFiles(process.cwd())];
    expect(files.length, 'the walk found no route.ts — a screen over nothing prints OK').toBeGreaterThan(400);
    expect(files.filter((f) => f.includes('/api/public/'))).not.toHaveLength(0);
  });

  it('passes on this tree, which is the point of the fix', () => {
    expect(scan(process.cwd())).toEqual([]);
  });

  it('every allowlisted file really does carry the shape it is excused for', () => {
    // An exception that no longer matches anything is dead weight that hides the
    // next offender; this fails the day the route stops needing it.
    for (const rel of ALLOW.keys()) {
      const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
      expect(scanSource(rel, src).length, `${rel} is allowlisted but no longer returns an empty payload from a catch`).toBeGreaterThan(0);
    }
  });
});
