/*!
 * NuCRM Enterprise — Visitor Tracking Snippet
 * Property of abetworks.in. Copyright (c) 2026 abetworks.in. All Rights Reserved.
 *
 * Embed on your marketing site / landing pages to feed the CRM visitor
 * intelligence (visitors + page_views tables, scored for lead prioritization):
 *
 *   <script>
 *     window.NUCRM_API_KEY = "pk_your_tenant_api_key";
 *     window.NUCRM_ENDPOINT = "https://app.yourdomain.com/api/tenant/visitors/track";
 *   </script>
 *   <script src="https://app.yourdomain.com/visitor-tracker.js" async></script>
 *
 * Notes:
 *   - The API key resolves the tenant server-side. Use a key scoped to
 *     visitor-tracking only.
 *   - visitorId is a first-party UUID kept in localStorage (nucrm_vid), so a
 *     returning browser is recognized and scored cumulatively.
 *   - This is for tracking YOUR prospects on YOUR sites — it is separate from
 *     in-app product analytics (/api/track/event).
 */
(function () {
  'use strict';

  var API_KEY = window.NUCRM_API_KEY;
  var ENDPOINT = window.NUCRM_ENDPOINT;
  if (!API_KEY || !ENDPOINT) {
    if (window.console && console.warn) {
      console.warn('[nucrm-tracker] NUCRM_API_KEY and NUCRM_ENDPOINT must be set before loading the tracker.');
    }
    return;
  }

  var VID_KEY = 'nucrm_vid';

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // RFC4122-ish fallback for older browsers.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getVisitorId() {
    try {
      var existing = localStorage.getItem(VID_KEY);
      if (existing) return existing;
      var id = uuid();
      localStorage.setItem(VID_KEY, id);
      return id;
    } catch (e) {
      // localStorage blocked — fall back to a per-load id.
      return uuid();
    }
  }

  var visitorId = getVisitorId();
  var enteredAt = Date.now();

  function send(useBeacon) {
    var payload = {
      visitorId: visitorId,
      fingerprintId: visitorId,
      url: location.pathname + location.search,
      title: document.title,
      referrer: document.referrer,
      duration: Math.round((Date.now() - enteredAt) / 1000),
    };
    var bodyStr = JSON.stringify(payload);

    // sendBeacon can't set custom headers, so page-exit tracking uses fetch
    // with keepalive to keep the x-api-key header.
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: bodyStr,
        keepalive: !!useBeacon,
        mode: 'cors',
        credentials: 'omit',
      })['catch'](function () {});
    } catch (e) {
      /* never block the host page */
    }
  }

  // Initial page view.
  send(false);

  // Update duration on exit.
  window.addEventListener('pagehide', function () { send(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send(true);
  });
})();
