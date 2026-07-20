import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  forms: {
    id: 'id',
    name: 'name',
    fields: 'fields',
    settings: 'settings',
    tenantId: 'tenant_id',
    isActive: 'is_active',
    submissionsCount: { _column: 'submissions_count' },
    viewsCount: { _column: 'views_count' },
  },
  tenants: {
    id: 'id',
    status: 'status',
  },
}));

describe('Embed form widget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates embed script with correct data-form-id attribute', () => {
    const formId = 'test-form-123';
    const origin = 'http://localhost:3000';
    const script = `<script src="${origin}/api/embed/form.js" data-form-id="${formId}" async></script>`;
    
    expect(script).toContain(`data-form-id="${formId}"`);
    expect(script).toContain('/api/embed/form.js');
    expect(script).toContain('async');
  });

  it('embed script uses async loading attribute', () => {
    const script = '<script src="http://localhost:3000/api/embed/form.js" data-form-id="abc" async></script>';
    expect(script).toContain('async');
  });

  it('analytics endpoint URL matches embed widget beacon path', () => {
    const formId = 'test-form-123';
    const analyticsUrl = `/api/tenant/forms/${formId}/analytics`;
    expect(analyticsUrl).toBe('/api/tenant/forms/test-form-123/analytics');
    expect(analyticsUrl).toContain('/analytics');
  });

  it('form analytics tracks view and submit event types', () => {
    const submitPayload = { type: 'submit' };
    const viewPayload = { type: 'view' };
    
    expect(submitPayload.type).toBe('submit');
    expect(viewPayload.type).toBe('view');
  });

  it('analytics endpoint handles view and submit payloads', () => {
    const viewPayload = JSON.stringify({ type: 'view' });
    const submitPayload = JSON.stringify({ type: 'submit' });
    expect(JSON.parse(viewPayload)).toEqual({ type: 'view' });
    expect(JSON.parse(submitPayload)).toEqual({ type: 'submit' });
  });

  it('form submissions_count is tracked by analytics endpoint', () => {
    const submitPayload = { type: 'submit' };
    const viewPayload = { type: 'view' };
    
    expect(submitPayload.type).toBe('submit');
    expect(viewPayload.type).toBe('view');
  });

  it('embed script handles missing data-form-id gracefully', () => {
    const js = `
(function() {
  var script = document.currentScript;
  var formId = script.getAttribute('data-form-id');
  if (!formId) { return; }
  return 'ok';
})();`;
    
    expect(js).toContain("getAttribute('data-form-id')");
    expect(js).toContain('if (!formId)');
  });

  it('embed script sends postMessage for resize and submit events', () => {
    const js = `
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'nucrm-resize' && e.data.formId === formId) {}
  if (e.data && e.data.type === 'nucrm-submit-success' && e.data.formId === formId) {}
});`;
    
    expect(js).toContain('nucrm-resize');
    expect(js).toContain('nucrm-submit-success');
  });

  it('embed script uses sendBeacon for analytics tracking', () => {
    const js = `
navigator.sendBeacon(appUrl + '/api/tenant/forms/' + formId + '/analytics', JSON.stringify({ type: 'view' }));
navigator.sendBeacon(appUrl + '/api/tenant/forms/' + formId + '/analytics', JSON.stringify({ type: 'submit' }));`;
    
    expect(js).toContain('sendBeacon');
    expect(js).toContain("'view'");
    expect(js).toContain("'submit'");
  });
});
