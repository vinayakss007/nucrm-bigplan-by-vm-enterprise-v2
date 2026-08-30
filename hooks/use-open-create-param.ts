/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect, useRef } from 'react';

/**
 * Opens a list page's "create" form when the URL carries `?action=create`.
 *
 * The ⌘K command palette links its "New Contact / Deal / Company / Task /
 * Meeting" actions to `/tenant/<entity>?action=create`, but historically no
 * list page read that param — so the palette navigated but the create form
 * never opened (a silently broken quick-create). This hook closes that gap.
 *
 * On mount (and whenever the URL search string changes) it checks for
 * `action=create`; if present it calls `open()` once, then strips the param via
 * history.replaceState so a refresh / back-forward doesn't re-trigger the form
 * and the URL stays clean. `paramValue` defaults to 'create' but can be
 * overridden if a page wants a different trigger.
 *
 * Note: reads window.location directly (not useSearchParams) so it works
 * without a Suspense boundary and can safely strip the param in place.
 */
export function useOpenCreateParam(open: () => void, paramValue: string = 'create'): void {
  const opener = useRef(open);
  opener.current = open;
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    if (url.searchParams.get('action') !== paramValue) return;

    handled.current = true;
    opener.current();

    // Strip ?action= so a reload / share / back-nav doesn't reopen the form.
    url.searchParams.delete('action');
    const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash;
    window.history.replaceState(window.history.state, '', clean);
  }, [paramValue]);
}
