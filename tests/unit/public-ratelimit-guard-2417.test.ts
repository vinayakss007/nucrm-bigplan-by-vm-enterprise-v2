/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHandlersEnumerated,
  enumerateHandlers,
  firstDbWork,
  handlerProblems,
  MIN_PUBLIC_HANDLERS,
  run,
  verifyEntry,
  type BaselineEntry,
} from '../../scripts/check-public-rate-limit.mts';

// #2417: the companion guard #2383 asked for. Like the other guards in this
// repo it fails *open* if its parser quietly breaks — a route tree it never
// walked reads as "all 0 handlers are rate-limited". So every case here is
// either a planted violation that must be named, or a known-good shape that
// must not be.

const ROOT = join(import.meta.dirname!, '..', '..');
const FIX = 'tests/unit/fixtures/public-ratelimit';
const SCRIPT = join(ROOT, 'scripts', 'check-public-rate-limit.mts');
const SELF = 'tests/unit/public-ratelimit-guard-2417.test.ts';

function fixtureHandlers(dir: string) {
  const file = `${FIX}/${dir}/route.ts`;
  return enumerateHandlers(readFileSync(join(ROOT, file), 'utf8'), file);
}

/** The line a handler was reported on must be the line that exports it. */
function assertExportsVerb(dir: string, line: number, verb: string) {
  const source = readFileSync(join(ROOT, FIX, dir, 'route.ts'), 'utf8').split('\n');
  expect(source[line - 1]).toContain(`export async function ${verb}`);
}

describe('enumerateHandlers — per handler, never per file', () => {
  it('finds every exported verb in the order it appears', () => {
    const handlers = fixtureHandlers('leaky');
    expect(handlers.map((h) => h.verb)).toEqual(['GET', 'POST']);
    assertExportsVerb('leaky', handlers[0].line, 'GET');
    assertExportsVerb('leaky', handlers[1].line, 'POST');
  });

  it('does not mistake the import line for a limiter call', () => {
    // `import { checkRateLimit }` sits above the first export, so it is
    // outside every handler slice — otherwise an unthrottled route would pass
    // merely by importing the helper.
    const [get] = fixtureHandlers('leaky');
    expect(get.limitAt).toBe(-1);
    expect(get.body).not.toContain("from '@/lib/rate-limit'");
  });

  it('credits a limiter placed anywhere inside the handler', () => {
    for (const h of fixtureHandlers('clean')) {
      expect(h.limitAt).toBeGreaterThan(-1);
      expect(h.actions).not.toEqual([]);
    }
  });
});

describe('firstDbWork — what the limiter has to beat', () => {
  it('recognises the query shapes', () => {
    expect(firstDbWork('const x = await db.query.a.findFirst()')).toBeGreaterThan(-1);
    expect(firstDbWork('await db.select({ id }).from(tables)')).toBeGreaterThan(-1);
    expect(firstDbWork('return Response.json({ ok: true })')).toBe(-1);
  });

  it('counts the portal identity resolver as database work', () => {
    // resolvePortalIdentity() is itself a query, so a limiter below it has
    // already paid for the request it is about to refuse.
    const body = 'const i = await resolvePortalIdentity(req);\nconst r = await db.select().from(t);';
    expect(firstDbWork(body)).toBeLessThan(body.indexOf('db.select'));
  });
});

describe('handlerProblems', () => {
  it('names an unthrottled handler and one with no explicit action', () => {
    const problems = handlerProblems(fixtureHandlers('leaky'));
    expect(problems.map((p) => p.kind).sort()).toEqual(['missing', 'no-action']);
    expect(problems.find((p) => p.kind === 'missing')?.verb).toBe('GET');
    expect(problems.every((p) => p.file === `${FIX}/leaky/route.ts`)).toBe(true);
    // The reason 'no-action' is its own kind: omitting `action` is not
    // missing a limiter, it is silently joining the shared 'api' bucket.
    expect(problems.find((p) => p.kind === 'no-action')?.detail).toContain("'api'");
  });

  it('says nothing about the known-good fixture', () => {
    expect(handlerProblems(fixtureHandlers('clean'))).toEqual([]);
  });

  it('flags a limiter that runs after the work it was meant to prevent', () => {
    const problems = handlerProblems(fixtureHandlers('late'));
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('late');
    expect(problems[0].detail).toContain('already touched the database');
  });

  it('flags two handlers sharing one action bucket, naming the other side', () => {
    const problems = handlerProblems(fixtureHandlers('duplicate'));
    expect(problems.map((p) => p.kind)).toEqual(['duplicate-action', 'duplicate-action']);
    expect(problems[0].detail).toContain('fixture-shared');
    expect(problems[0].detail).toContain(`${FIX}/duplicate/route.ts:`);
    expect(problems[0].verb).toBe('GET');
    expect(problems[1].verb).toBe('POST');
  });

  it('flags a handler that competes with itself across two limiter calls', () => {
    const source = [
      "export async function GET(req: Request) {",
      "  await checkRateLimit(req, { action: 'same', max: 5 });",
      "  await checkRateLimit(req, { action: 'same', max: 60 });",
      "  return Response.json({});",
      "}",
    ].join('\n');
    const problems = handlerProblems(enumerateHandlers(source, 'inline/route.ts'));
    expect(problems).toHaveLength(2);
    expect(new Set(problems.map((p) => p.kind))).toEqual(new Set(['duplicate-action']));
  });
});

describe('assertHandlersEnumerated — the guard cannot pass by finding nothing', () => {
  it('refuses to certify a run that enumerated almost no handlers', () => {
    expect(() => assertHandlersEnumerated(MIN_PUBLIC_HANDLERS - 1)).toThrow(/was not walked/);
    expect(() => assertHandlersEnumerated(2)).toThrow(/only 2 public handler/);
    expect(() => assertHandlersEnumerated(MIN_PUBLIC_HANDLERS)).not.toThrow();
  });

  it('floors at a number the real tree clears', () => {
    expect(MIN_PUBLIC_HANDLERS).toBeGreaterThanOrEqual(15);
  });
});

describe('verifyEntry — an exemption is re-derived, never trusted', () => {
  const good: BaselineEntry = {
    file: `${FIX}/leaky/route.ts`,
    verb: 'GET',
    reason: 'Deliberate: this fixture exists to prove the guard fires, and the '
      + 'exemption machinery needs a real target to verify against.',
    pinnedBy: SELF,
  };

  it('accepts a well-formed entry', () => {
    expect(verifyEntry(good, ROOT)).toBeNull();
  });

  it('rejects a reason that is not a sentence', () => {
    expect(verifyEntry({ ...good, reason: 'fine' }, ROOT)).toMatch(/under 40 characters/);
  });

  it('rejects an exemption that names no pinning test', () => {
    expect(verifyEntry({ ...good, pinnedBy: 'tests/unit/does-not-exist.test.ts' }, ROOT))
      .toMatch(/names no pinning test/);
  });

  it('rejects an entry whose route file is gone', () => {
    expect(verifyEntry({ ...good, file: `${FIX}/deleted/route.ts` }, ROOT)).toMatch(/no longer exists/);
  });

  it('rejects an entry for a verb the file stopped exporting', () => {
    expect(verifyEntry({ ...good, verb: 'DELETE' }, ROOT)).toMatch(/no longer exports a DELETE/);
  });
});

describe('run — baselining', () => {
  const exemption: BaselineEntry = {
    file: `${FIX}/leaky/route.ts`,
    verb: 'GET',
    reason: 'The leaky fixture is the planted violation; this entry exists to '
      + 'prove an exemption silences exactly one handler and nothing wider.',
    pinnedBy: SELF,
  };

  it('silences the named handler and only the named handler', async () => {
    const bare = await run(ROOT, { dirs: [`${FIX}/leaky`], baseline: [] });
    expect(bare.problems.map((p) => p.kind).sort()).toEqual(['missing', 'no-action']);

    const exempted = await run(ROOT, { dirs: [`${FIX}/leaky`], baseline: [exemption] });
    expect(exempted.problems.map((p) => p.kind)).toEqual(['no-action']);
    expect(exempted.stale).toEqual([]);
  });

  it('cannot be used to waive the ordering or bucket rules', async () => {
    const late = await run(ROOT, {
      dirs: [`${FIX}/late`],
      baseline: [{ ...exemption, file: `${FIX}/late/route.ts` }],
    });
    expect(late.problems.map((p) => p.kind)).toEqual(['late']);

    const dupe = await run(ROOT, {
      dirs: [`${FIX}/duplicate`],
      baseline: [
        { ...exemption, file: `${FIX}/duplicate/route.ts`, verb: 'GET' },
        { ...exemption, file: `${FIX}/duplicate/route.ts`, verb: 'POST' },
      ],
    });
    expect(dupe.problems.map((p) => p.kind)).toEqual(['duplicate-action', 'duplicate-action']);
  });

  it('treats an unverifiable exemption as a violation again', async () => {
    const result = await run(ROOT, {
      dirs: [`${FIX}/leaky`],
      baseline: [{ ...exemption, file: `${FIX}/gone/route.ts` }],
    });
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].why).toMatch(/no longer exists/);
    // the GET it no longer covers is reported once more
    expect(result.problems.map((p) => p.kind).sort()).toEqual(['missing', 'no-action']);
  });

  it('ratchets down an exemption whose handler is now rate-limited', async () => {
    const result = await run(ROOT, {
      dirs: [`${FIX}/clean`],
      baseline: [
        { ...exemption, file: `${FIX}/clean/route.ts`, verb: 'GET' },
        { ...exemption, file: `${FIX}/clean/route.ts`, verb: 'POST' },
      ],
    });
    expect(result.problems).toEqual([]);
    expect(result.unused.map((e) => e.verb).sort()).toEqual(['GET', 'POST']);
  });

  it('reports one problem per handler even when two rules fire on it', async () => {
    // GET on the leaky fixture is unthrottled; POST is missing an action. No
    // handler is double-booked for the same defect.
    const result = await run(ROOT, { dirs: [`${FIX}/leaky`], baseline: [] });
    expect(new Set(result.problems.map((p) => `${p.file}:${p.verb}:${p.kind}`)).size)
      .toBe(result.problems.length);
  });
});

describe('the guard as CI runs it', () => {
  function cli(dir: string, extra: string[] = []) {
    return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...extra, dir], {
      cwd: ROOT, encoding: 'utf8',
    });
  }

  it('exits non-zero naming file, handler and defect', () => {
    const result = cli(`${FIX}/leaky`);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${FIX}/leaky/route.ts`);
    expect(result.stdout).toMatch(/GET.*missing/);
    expect(result.stdout).toMatch(/POST.*no-action/);
  });

  it('exits zero on the known-good fixture', () => {
    const result = cli(`${FIX}/clean`);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OK — 2 public handler/);
  });

  it('--json reports the same findings structurally', () => {
    const result = cli(`${FIX}/duplicate`, ['--json']);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      handlers: number;
      problems: Array<{ verb: string; kind: string; line: number }>;
      failures: unknown[];
    };
    expect(payload.handlers).toBe(2);
    expect(payload.problems.map((p) => p.kind)).toEqual(['duplicate-action', 'duplicate-action']);
    expect(payload.failures).toHaveLength(2);
    expect(payload.problems.every((p) => p.line > 0)).toBe(true);
  });
});

describe('the real public tree', () => {
  it('is fully covered, so CI has something to hold the line on', async () => {
    const result = await run('.');
    expect(result.files).toBe(14);
    expect(result.handlers).toBe(17);
    expect(result.problems).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.unused).toEqual([]);
  });

  it('has no exemption today — the baseline is empty, not load-bearing', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'scripts', 'public-ratelimit-baseline.json'), 'utf8')) as {
      entries: BaselineEntry[];
    };
    expect(raw.entries).toEqual([]);
  });
});
