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
 * Step 4a (2026-10-26) did not delete an entry; it moved `app/api/webhooks` off its 44 ceiling to 42 by
 * binding the inbound `apiKeys` lookup and its trail write in `lib/webhooks/inbound-auth.ts`, which is a
 * pinned target rather than a deferred directory. Step 4b took it to 30 by binding the 12 Resend reads
 * rather than excusing them: the attribution opens 0105's `app.tracking_lookup` arm and adopts the
 * workspace it resolves, and the write handlers run each statement inside `withTenantContext`. Both
 * halves live in `lib/email/` because the route's 500-line cap had no room left, so they left the
 * deferred directory instead of becoming a bigger exemption. The ceiling is a count that may only go
 * down, so the number below is the measured run, not the number the entry was invented with.
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
  it('has exactly the three directories, at the ceilings they were measured with', () => {
    expect(SCOPE_DEFERRALS.map((d) => d.dir)).toEqual([
      'app/api/cron',
      'app/api/webhooks',
      'app/api/auth/sso',
    ]);
    expect(SCOPE_DEFERRALS.map((d) => d.maxFindings)).toEqual([59, 30, 2]);
    for (const entry of SCOPE_DEFERRALS) {
      expect(verifyDeferral(entry), `${entry.dir} — ${verifyDeferral(entry) ?? ''}`).toBeNull();
    }
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
    expect(SCOPE_DEFERRALS.filter((d) => d.deferredTo === '#3246').map((d) => d.dir)).toEqual([
      'app/api/webhooks',
      'app/api/auth/sso',
    ]);
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
