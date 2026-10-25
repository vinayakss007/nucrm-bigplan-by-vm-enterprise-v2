/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3186 — the portal RLS guard's scope must be derived, and every finding the
 * wider walk reports has to be *accounted for*, not waved at.
 *
 * `check-portal-rls-context.mts` used to answer "what is the anonymous surface?"
 * from a list of directories in its own source, while its sibling
 * `check-public-row-projection.mts` had read `proxy.ts` since #2232. Measured at
 * `7ff9dc24f` that cost 42 of 53 public dirs — 69 files, 147 tenant-keyed reads,
 * 120 findings nobody was looking at — and the two precedents (#3163's capture
 * path, #3182's invitation routes) were both invisible until someone added a
 * line. Deriving it here is the same fix #3179 landed for `apply-rls-ci`.
 *
 * Deriving the scope is the easy half. The honest half is what to do with the
 * findings, and the answer is not "baseline them all": most are a DIFFERENT
 * question — cron iterates tenants deliberately (#2539), webhooks authenticate
 * by signing secret and must resolve a tenant from a provider payload, and
 * `sso` acts on a credential that grants no row-level privilege in the shipped
 * policy set (#3102). Calling those #2446 breaks would
 * be a false alarm; hiding them would re-open the hole. So each is deferred BY
 * DIRECTORY and pinned by a COUNT that may only go down.
 *
 * `app/api/metrics` was in that ledger and is not any more: #3195 took the
 * bare-pool CRM aggregate out of the scrape, so the directory excuses nothing,
 * the entry had to go, and the assertion below is what made deleting it the only
 * way to stay green. Note what #3195 did NOT do — it did not answer #3102's
 * privilege question; the counts are withheld, not read.
 *
 * `app/api/auth/oauth` (#3225, #3231) and `app/api/unsubscribe` (#3237) left the
 * ledger the other way: their privilege was invented, the reads were bound, and
 * the count went to zero. The last block in this file is the unsubscribe one,
 * because "the entry was deleted because the guard stopped seeing a reason" needs
 * proving in both directions.
 *
 * Two findings were not that: `/api/flags` and `/api/track/event` read
 * `tenant_members` for a caller whose identity the route had already verified.
 * Those are the #2446 shape (#3196, #3197) and they are fixed at the call site —
 * the last block runs the analyzer over the real files to prove the fix is there
 * AND that the guard would catch it coming back.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeSource,
  applyDeferrals,
  buildTargets,
  DEFAULT_TARGETS,
  findReads,
  loadTenantTables,
  maskComments,
  MIN_SCANNED_FILES,
  MIN_TABLE_READS,
  PINNED_TARGETS,
  publicScopeDirs,
  run,
  SCOPE_DEFERRALS,
  verifyDeferral,
  type ScopeDeferral,
  type TenantTable,
  type Violation,
} from '../../scripts/check-portal-rls-context.mts';

const ROOT = join(import.meta.dirname!, '..', '..');

const v = (file: string, table = 'contacts'): Violation =>
  ({ file, table, line: 1, problem: 'the bare pool `db`' });

let repoTables: Map<string, TenantTable>;
beforeAll(async () => {
  repoTables = await loadTenantTables(ROOT);
}, 30_000);

describe('the scope is derived from the edge, not remembered (#3186)', () => {
  it('reaches every public dir proxy.ts advertises — 53, where the hand list walked 11', () => {
    const derived = publicScopeDirs(ROOT);
    expect(derived.length).toBeGreaterThanOrEqual(50);
    // The classes #3186 measured as invisible. Naming them here is what makes
    // "the list stopped being parsed" a red test rather than a quiet OK.
    for (const dir of ['app/api/cron', 'app/api/webhooks/inbound', 'app/api/metrics',
      'app/api/unsubscribe', 'app/api/auth/sso', 'app/api/tenant/plugins/webhook']) {
      expect(derived, dir).toContain(dir);
    }
  });

  it('unions with the hand list and never subtracts from it', () => {
    const targets = buildTargets(ROOT);
    // `lib/portal-auth.ts` and `lib/portal-session.ts` are libraries: no
    // PUBLIC_PATHS entry names them, so a derivation that REPLACED the list
    // would have silently dropped two of the files #2446 was written for.
    for (const pinned of PINNED_TARGETS) expect(targets, pinned).toContain(pinned);
    for (const dir of publicScopeDirs(ROOT)) expect(targets, dir).toContain(dir);
    expect(targets).toEqual([...targets].sort());
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('DEFAULT_TARGETS IS that union, and the walk floor is the surface it produces', async () => {
    expect(DEFAULT_TARGETS).toEqual(buildTargets(ROOT));
    const res = await run(DEFAULT_TARGETS, ROOT, { tables: repoTables });
    expect(res.files).toBe(MIN_SCANNED_FILES);
    expect(res.reads).toBeGreaterThanOrEqual(MIN_TABLE_READS);
  }, 60_000);

  it('refuses to derive a scope from an edge list it could not parse', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rls-scope-'));
    try {
      expect(() => publicScopeDirs(scratch)).toThrow(/proxy\.ts is missing/);
      writeFileSync(join(scratch, 'proxy.ts'), 'export const PUBLIC_PATHS: string[] = [];\n');
      expect(() => publicScopeDirs(scratch)).toThrow(/no \/api\/ entry was matched/);
      writeFileSync(join(scratch, 'proxy.ts'),
        "const PUBLIC_PATHS = ['/api/nope/exists'];\nconst PUBLIC_PREFIXES: string[] = [];\n");
      expect(() => publicScopeDirs(scratch)).toThrow(/resolves to app\/<path>/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('a deferral is a counted exemption, and the count is the ratchet (#3186)', () => {
  it('every entry is admissible on its face', () => {
    for (const entry of SCOPE_DEFERRALS) {
      expect(verifyDeferral(entry), `${entry.dir} — ${verifyDeferral(entry) ?? ''}`).toBeNull();
    }
    // No directory that the #2446 rule can actually judge may hide behind a
    // deferral: the anonymous portal surface stays reported. The list is what
    // is left AFTER #3195 took `app/api/metrics` off it — re-adding it would
    // have to reopen this assertion, and the reason it was deleted (the route
    // reads no tenant-policyed table at all) is pinned in
    // tests/unit/metrics-tenant-count-3195.test.ts. `app/api/auth/oauth` and
    // `app/api/unsubscribe` came off the same regex when #3225/#3231 and #3237
    // invented their privileges and bound the reads; a route that has been fixed
    // must not be able to take its exemption back.
    for (const entry of SCOPE_DEFERRALS) {
      expect(entry.dir, entry.deferredTo).toMatch(
        /^app\/api\/(cron|webhooks|auth\/sso|tenant\/plugins\/webhook)$/,
      );
    }
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).not.toContain('app/api/metrics');
  });

  it('rejects a reason too short to argue with, a non-issue, a rooted dir, and a zero pin', () => {
    const ok: ScopeDeferral = { dir: 'app/api/x', deferredTo: '#1', why: 'a'.repeat(41), maxFindings: 1 };
    expect(verifyDeferral(ok)).toBeNull();
    expect(verifyDeferral({ ...ok, why: 'too short' })).toMatch(/40 characters/);
    expect(verifyDeferral({ ...ok, deferredTo: 'later' })).toMatch(/must be the issue/);
    expect(verifyDeferral({ ...ok, dir: '../app/api/x' })).toMatch(/repository-relative/);
    expect(verifyDeferral({ ...ok, dir: '/app/api/x' })).toMatch(/repository-relative/);
    expect(verifyDeferral({ ...ok, maxFindings: 0 })).toMatch(/pinned at 0/);
  });

  it('reports a class that grew, so a new unbound read cannot join quietly', () => {
    const deferrals = [{ dir: 'app/api/cron', deferredTo: '#2539', why: 'x'.repeat(41), maxFindings: 2 }];
    const found = [v('app/api/cron/a/route.ts'), v('app/api/cron/b/route.ts'), v('app/api/cron/c/route.ts')];
    const { kept, deferred } = applyDeferrals(found, deferrals);
    expect(deferred).toEqual([]);
    expect(kept.map((k) => k.problem).join('\n')).toMatch(/pinned at 2 contextless read\(s\) \(#2539\) and 3 were found/);
  });

  it('reports a class that went to zero, so a fixed directory comes back into scope', () => {
    const deferrals = [{ dir: 'app/api/cron', deferredTo: '#2539', why: 'x'.repeat(41), maxFindings: 5 }];
    const { kept, deferred } = applyDeferrals([v('app/api/webhooks/stripe/route.ts')], deferrals);
    expect(deferred).toEqual([]);
    expect(kept.map((k) => `${k.file}: ${k.problem}`).join('\n')).toMatch(/app\/api\/cron.*excuses nothing/);
  });

  it('an inadmissible entry reports itself and excuses nothing under it', () => {
    const deferrals = [{ dir: 'app/api/cron', deferredTo: 'someday', why: 'x'.repeat(41), maxFindings: 5 }];
    const { kept, deferred } = applyDeferrals([v('app/api/cron/a/route.ts')], deferrals);
    expect(deferred).toEqual([]);
    expect(kept).toHaveLength(2);
    expect(kept[0]!.problem).toMatch(/not admissible/);
    expect(kept[1]!.file).toBe('app/api/cron/a/route.ts');
  });

  it('prefixes do not overlap: one finding, one deferral', () => {
    // The nested entry is the interesting one: `app/api/tenant/plugins/webhook` sits
    // inside `app/api/tenant`, which is in scope unconditionally, so a finding there has
    // to land on exactly one count and not be claimed twice. (#3186 wrote this against
    // `app/api/auth/oauth`, which #3225 and #3231 bounded out of the ledger — see the
    // note above SCOPE_DEFERRALS.)
    const { kept, deferred } = applyDeferrals([v('app/api/tenant/plugins/webhook/callback/route.ts')], SCOPE_DEFERRALS);
    expect(kept.filter((k) => k.file === 'app/api/tenant/plugins/webhook/callback/route.ts')).toEqual([]);
    expect(deferred.filter((d) => d.dir === 'app/api/tenant/plugins/webhook').map((d) => d.count)).toEqual([1]);
  });

  it('each live deferral sits EXACTLY on its pin — growth and rot both fail', async () => {
    const res = await run(DEFAULT_TARGETS, ROOT, { tables: repoTables, deferrals: [] });
    const counts = new Map<string, number>();
    for (const violation of res.violations) {
      const owner = SCOPE_DEFERRALS
        .filter((d) => violation.file === d.dir || violation.file.startsWith(`${d.dir}/`))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
      if (owner) counts.set(owner.dir, (counts.get(owner.dir) ?? 0) + 1);
    }
    for (const entry of SCOPE_DEFERRALS) {
      const measured = counts.get(entry.dir) ?? 0;
      expect(measured, `${entry.dir} (${entry.deferredTo}) moved off its pin of ${entry.maxFindings}: `
        + 're-measure and say why').toBe(entry.maxFindings);
    }
    // And everything outside the ledger is still reported, so the pin list is the
    // whole excuse and not a filter that happens to match the current output.
    const unowned = res.violations.filter((x) => !SCOPE_DEFERRALS
      .some((d) => x.file === d.dir || x.file.startsWith(`${d.dir}/`)));
    expect(unowned.map((x) => `${x.file}:${x.line} ${x.table}`)).toEqual([]);
  }, 60_000);
});

/**
 * The (a)-bucket: a route that already knows who the caller is, reading a
 * policyed table on the pool. #3196 and #3197 — fixed here rather than deferred,
 * because unlike cron/webhooks there IS a GUC for these reads to key on
 * (`app.current_user`, which is what 0127's `tenant_members_self_read` and
 * `users_read_self` are written against). #3195's metrics scrape is the
 * contrast case: no user, no tenant, no GUC that answers a fleet total — so it
 * could not be bound the way these two were, and it was taken out of the guard's
 * scope by deleting the read instead.
 */
describe('the two session-authenticated reads the wider walk found are bound (#3196, #3197)', () => {
  const fixed = [
    { file: 'app/api/flags/route.ts', table: 'tenantMembers' },
    { file: 'app/api/track/event/route.ts', table: 'tenantMembers' },
  ];

  for (const { file, table } of fixed) {
    it(`${file}: the guard sees the ${table} read, and finds no unbound handle`, () => {
      const raw = readFileSync(join(ROOT, file), 'utf8');
      const js = findReads(maskComments(raw), repoTables).map((r) => r.js);
      expect(js, file).toContain(table);
      expect(analyzeSource(file, raw, repoTables, [], ROOT).violations, file).toEqual([]);
    });

    it(`${file}: un-binding the context makes the guard report it again`, () => {
      // Non-vacuity. Renaming the helper is how the analyzer loses a handle: it
      // binds callback parameters of CONTEXT_HELPERS calls by name, so if the
      // route ever regains a `withUserContext`-shaped call that was quietly
      // removed, this is the red the suite throws.
      const raw = readFileSync(join(ROOT, file), 'utf8').replace(/withUserContext\(/g, 'noteUserContext(');
      const found = analyzeSource(file, raw, repoTables, [], ROOT);
      const offenders = found.violations.filter((x) => x.table === table);
      expect(offenders.length, file).toBeGreaterThan(0);
      expect(offenders.map((x) => x.problem).join('\n'), file)
        .toMatch(/is not bound by a context-establishing call|the bare pool/);
    });
  }
});

/**
 * The ledger's other exit: `app/api/unsubscribe` was deferred because no GUC could
 * name the row its verified link had to write (#3102's open question). #3237 answered
 * it — 0138's claim pair behind `app.unsubscribe_contact`, opened by
 * `withUnsubscribeContactContext` — so the entry's 3 findings went to zero and the
 * entry had to go. This is the proof that the deletion was earned rather than convenient:
 * the guard sees all three statements, finds none of them unbound, and would report
 * them again the moment the context call disappeared.
 */
describe('the unsubscribe route the wider walk could not bind is bound now (#3237)', () => {
  const file = 'app/api/unsubscribe/route.ts';
  const tables = ['contacts', 'sequenceEnrollments', 'activities'];

  it('the guard sees all three policyed statements it deferred for', () => {
    const js = findReads(maskComments(readFileSync(join(ROOT, file), 'utf8')), repoTables).map((r) => r.js);
    for (const table of tables) expect(js, `${table} read`).toContain(table);
  });

  it('and reports nothing, with no baseline and no deferral in the way', () => {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    expect(analyzeSource(file, raw, repoTables, [], ROOT).violations, file).toEqual([]);
    // The entry is gone, so nothing in the ledger can be covering this directory.
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).not.toContain('app/api/unsubscribe');
  });

  it('renaming the context call brings all three findings back', () => {
    // Non-vacuity, the same shape as #3196/#3197 above: the analyzer binds a
    // callback parameter by the NAME of the context helper that owns it, so a
    // route that quietly drops `withUnsubscribeContactContext` for a lookalike
    // loses the privilege and not the report.
    const raw = readFileSync(join(ROOT, file), 'utf8')
      .replace(/withUnsubscribeContactContext\(/g, 'noteUnsubscribeContactContext(');
    const offenders = analyzeSource(file, raw, repoTables, [], ROOT).violations
      .filter((x) => tables.includes(x.table));
    expect(offenders.map((x) => x.table).sort(), file).toEqual([...tables].sort());
    expect(offenders.map((x) => x.problem).join('\n'), file)
      .toMatch(/is not bound by a context-establishing call|the bare pool/);
  });
});
