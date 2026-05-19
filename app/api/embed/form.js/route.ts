import { NextRequest, NextResponse } from 'next/server';

/**
 * Dynamic Form Embed Script
 * 
 * Usage: <script src="https://yourcrm.com/api/embed/form.js" data-form-id="FORM_ID"></script>
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  
  const js = `
(function() {
  const script = document.currentScript;
  const formId = script.getAttribute('data-form-id');
  
  if (!formId) {
    console.error('[NuCRM] Missing data-form-id on script tag');
    return;
  }

  // Create container
  const container = document.createElement('div');
  container.id = 'nucrm-form-' + formId;
  container.className = 'nucrm-form-container';
  script.parentNode.insertBefore(container, script);

  // Inject Iframe
  const iframe = document.createElement('iframe');
  iframe.src = '${appUrl}/forms/public/' + formId + '?embed=true';
  iframe.style.width = '100%';
  iframe.style.height = '600px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '12px';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('loading', 'lazy');
  
  container.appendChild(iframe);

  // Listen for resize messages from iframe
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'nucrm-resize' && e.data.formId === formId) {
      iframe.style.height = e.data.height + 'px';
    }
    if (e.data && e.data.type === 'nucrm-submit-success' && e.data.formId === formId) {
      // Optional: scroll to top of form
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();
  `.trim();

  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
