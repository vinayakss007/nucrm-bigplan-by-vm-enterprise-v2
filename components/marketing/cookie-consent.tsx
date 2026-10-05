/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'nucrm_cookie_consent';

/**
 * Cookie-consent banner for the marketing site.
 *
 * NuCRM sets only strictly-necessary session cookies plus optional interface
 * preferences in local storage (see /legal/cookies), so the two choices differ
 * in whether preferences are remembered — never in tracking, because there is
 * no tracking to opt into. The banner appears once per browser until a choice
 * is recorded under CONSENT_KEY.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      // Storage unavailable (private mode / blocked): show the banner without persisting.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const record = (value: 'all' | 'essential') => {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Nothing to do if storage is blocked; the choice simply isn't remembered.
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 rounded-2xl border border-white/[0.10] bg-[#0a1435]/95 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-slate-300">
          We use essential cookies to run NuCRM, and — if you accept — browser storage to remember your theme and interface
          preferences. No advertising or tracking cookies. Read the{' '}
          <Link href="/legal/cookies" className="text-sky-300 underline-offset-2 hover:underline">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => record('essential')}
            className="mk-btn mk-btn-ghost !min-h-[40px] !px-4 !text-[13.5px]"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => record('all')}
            className="mk-btn mk-btn-primary !min-h-[40px] !px-4 !text-[13.5px]"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
