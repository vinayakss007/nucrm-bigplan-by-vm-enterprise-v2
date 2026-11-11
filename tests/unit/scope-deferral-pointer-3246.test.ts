/**
 * #3246 — a `SCOPE_DEFERRALS` pointer is a claim about who owns the work, and it rots silently.
 *
 * `verifyDeferral()` checks the SHAPE of `deferredTo` (`/^#\d+$/`) and nothing else, so an entry can
 * name an issue that closed weeks ago and still excuse its whole count ceiling. Three of the four
 * entries did exactly that for #3102 after it shipped 0134–0137 and was closed COMPLETED on
 * 2026-10-24: `44/44`, `2/2` and `1/1` reads sat at their ceilings behind a pointer that said someone
 * was tracking them, while the file's own rule above the list is that "an exemption that excuses
 * nothing is itself a finding".
 *
 * Checking liveness would need the GitHub API at guard time, which a static screen does not have. What
 * it CAN hold is that the reason names the issue the count is deferred to, and that the ledger does not
 * still point at the closed credential work — so this file pins the shape of the ledger as of #3246 and
 * fails the moment a pointer drifts back.
 *
 * Step 2 (2026-10-25) bound `app/api/tenant/plugins/webhook`'s 1 read behind migration 0139's arm and
 * deleted its entry, the way #3225, #3231 and #3237 each deleted one. The four-directory ledger this
 * file was cut against is now three, and the equality assertions below are what says so.
 *
 * Step 3 (2026-10-26) did the same to `app/api/auth/sso`'s 2 reads behind migration 0140's two arms, so
 * the ledger is two and only #3246's webhook surface is left counting against it.
 *
 * Step 4 (2026-11-11) deleted #3312's two lib/ entries: `lib/webhooks` (22 reads in delivery, DLQ and
 * field-mapping) and `lib/stripe-subscription-sync.ts` (2) now bind a tenant context — or the 0093
 * super-admin arm where the caller is the cross-tenant cron — instead of reading the bare pool. The
 * ledger is the two route surfaces below; the lib/ ratchet is green rather than exempted.
 *
 * Step 5 (2026-11-11) deleted the last #3246 entry, `app/api/webhooks` (24 reads). All 24 were in
 * `app/api/webhooks/inbound/route.ts`, and they rode the PP-027 carrier instead of naming a context:
 * the route adopts its tenant in `resolveApiKey` and then read tenant-policyed tables through a
 * `db.transaction()` handle that carried no `app.current_tenant`. The item transaction now opens
 * `withTenantContext(tenantId, …)`, so the directory is back in scope and the ledger is ONE entry:
 * `app/api/cron` → #2539, the scheduled job that iterates every tenant on purpose.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCOPE_DEFERRALS, verifyDeferral } from '../../scripts/check-portal-rls-context.mts';

const GUARD_SRC = readFileSync(
  resolve(process.cwd(), 'scripts/check-portal-rls-context.mts'),
  'utf8',
);

describe('#3246 the deferral ledger points at live work', () => {
  it('has exactly the directories still deferred, at the ceilings they were measured with', () => {
    // One entry left: the cron surface, which is #2539's per-tenant context
    // loop. #3246's own webhook surface and #3312's two lib/ surfaces are
    // bound now, so their entries are gone rather than re-pinned.
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).toEqual([
      'app/api/cron',
    ]);
    expect(SCOPE_DEFERRALS.map((d) => d.maxFindings)).toEqual([59]);
    for (const entry of SCOPE_DEFERRALS) {
      expect(verifyDeferral(entry), `${entry.dir} — ${verifyDeferral(entry) ?? ''}`).toBeNull();
    }
  });

  it('does not defer the webhook surface any more — it is bound, not excused', () => {
    // The entry this file's issue asked for. While it existed, a NEW unbound
    // read under app/api/webhooks would have been absorbed by the 24/24
    // ceiling; now the directory is in scope and one is a red build.
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).not.toContain('app/api/webhooks');
  });

  it('names its own `deferredTo` inside the reason a reviewer is supposed to be able to argue with', () => {
    for (const entry of SCOPE_DEFERRALS) {
      expect(entry.why, `${entry.dir} defers to ${entry.deferredTo} but its why never names it`).toContain(
        entry.deferredTo,
      );
    }
  });

  it('defers nothing to #3102, which closed COMPLETED on 2026-10-24', () => {
    // #3102 was the app-MINTED bearer credential family (reset tokens, verification tokens, OAuth
    // codes) — 0134–0137 plus #3225/#3231/#3237. A tenant derived from a provider signature, an
    // issuer/state handoff, or an anonymous callback URL is a different privilege shape, and #3246
    // is where that work is now tracked.
    for (const entry of SCOPE_DEFERRALS) {
      expect(entry.deferredTo, entry.dir).not.toBe('#3102');
      expect(entry.why, `${entry.dir}'s why still argues with a closed issue`).not.toContain('#3102');
    }
    // #3246's own entry is gone: the inbound route binds its 24 reads, so the
    // ledger defers to #2539 alone and no entry names #3246 any more.
    expect(SCOPE_DEFERRALS.filter((d) => d.deferredTo === '#3246').map((d) => d.dir)).toEqual([]);
    expect(SCOPE_DEFERRALS.map((d) => d.deferredTo)).toEqual(['#2539']);
  });

  it('leaves the narrative above the list telling the same story the entries do', () => {
    const doc = GUARD_SRC.slice(0, GUARD_SRC.indexOf('export const SCOPE_DEFERRALS'));
    // The two prose pointers that used to call the open decision #3102's now name #3246, and the
    // ledger's history paragraph says why the move happened instead of silently re-writing it.
    expect(doc).toContain('#3246');
    expect(doc).toMatch(/closed COMPLETED/);
    expect(doc).toMatch(/never that the issue it names is still open/);
  });
});
