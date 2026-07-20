import { NextRequest, NextResponse } from 'next/server';

/**
 * Dynamic Form Embed Script
 * 
 * Usage: <script src="https://yourcrm.com/api/embed/form.js" data-form-id="FORM_ID" async></script>
 * 
 * Features:
 * - Renders form in iframe (cross-origin safe)
 * - Auto-resizes iframe height
 * - Tracks form views and submissions for analytics
 * - Sends postMessage for resize and submit events
 */
export async function GET(_req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  
  const js = `
(function() {
  var script = document.currentScript;
  var formId = script.getAttribute('data-form-id');
  
  if (!formId) {
    console.error('[NuCRM] Missing data-form-id on script tag');
    return;
  }

  var appUrl = '${appUrl}';

  // Track view (non-blocking beacon)
  try {
    navigator.sendBeacon(appUrl + '/api/tenant/forms/' + formId + '/analytics', JSON.stringify({ type: 'view' }));
  } catch (_) {}

  // Create container
  var container = document.createElement('div');
  container.id = 'nucrm-form-' + formId;
  container.className = 'nucrm-form-container';
  script.parentNode.insertBefore(container, script);

  // Inject Iframe
  var iframe = document.createElement('iframe');
  iframe.src = appUrl + '/forms/public/' + formId + '?embed=true';
  iframe.style.width = '100%';
  iframe.style.height = '600px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '12px';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('loading', 'lazy');
  iframe.title = 'NuCRM Form';
  
  container.appendChild(iframe);

  // Listen for resize messages from iframe
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'nucrm-resize' && e.data.formId === formId) {
      iframe.style.height = e.data.height + 'px';
    }
    if (e.data && e.data.type === 'nucrm-submit-success' && e.data.formId === formId) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Track submit (non-blocking beacon)
      try {
        navigator.sendBeacon(appUrl + '/api/tenant/forms/' + formId + '/analytics', JSON.stringify({ type: 'submit' }));
      } catch (_) {}
    }
  });
})();
  `.trim();

  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
