import { describe, it, expect } from 'vitest';

// ── Form Embed Widget ──────────────────────────────────────────────

// Import the handler as raw source to avoid Next.js server context
// We test the JS content and the response shape
import * as embedRoute from '@/app/api/embed/form.js/route';

describe('Form Embed Widget (/api/embed/form.js)', () => {
  it('GET returns a JavaScript response with correct content type', async () => {
    const res = await embedRoute.GET();
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('GET includes CORS Access-Control-Allow-Origin: *', async () => {
    const res = await embedRoute.GET();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('GET returns JS that references the form loader pattern', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('nucrm-embed-form');
    expect(js).toContain('fetch');
    expect(js).toContain('/api/tenant/forms/public/');
    expect(js).toContain('/api/forms/submit');
  });

  it('GET JS handles missing form ID gracefully', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('Missing form ID');
  });

  it('GET JS includes field rendering for text, textarea, select, checkbox', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('textarea');
    expect(js).toContain('select');
    expect(js).toContain('checkbox');
  });

  it('GET JS includes view and submit tracking', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('trackView');
    expect(js).toContain('trackSubmit');
    expect(js).toContain('/analytics');
  });

  it('GET JS includes success state rendering', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('nucrm-form-success');
    expect(js).toContain('Thank you');
  });

  it('GET JS includes error handling', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('nucrm-form-error');
    expect(js).toContain('Something went wrong');
  });

  it('OPTIONS returns CORS preflight headers', async () => {
    const res = await embedRoute.OPTIONS();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('GET JS includes inline styles (self-contained, no external CSS)', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('style="');
    expect(js).toContain('font-family');
  });

  it('GET JS includes submit button disable/enable during submission', async () => {
    const res = await embedRoute.GET();
    const js = await res.text();
    expect(js).toContain('submitBtn.disabled = true');
    expect(js).toContain('submitBtn.disabled = false');
  });
});

// ── Form Analytics POST handler ─────────────────────────────────────

import * as analyticsRoute from '@/app/api/tenant/forms/[id]/analytics/route';

describe('Form Analytics POST (/api/tenant/forms/[id]/analytics)', () => {
  it('POST handler is exported', () => {
    expect(typeof analyticsRoute.POST).toBe('function');
  });

  it('OPTIONS returns CORS preflight headers', async () => {
    const res = await analyticsRoute.OPTIONS();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
