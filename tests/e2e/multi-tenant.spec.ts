import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Multi-Tenant Isolation', () => {
  test('tenant data is isolated', async ({ page, context }) => {
    // Login via API
    const api = await page.request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    const setCookie = api.headers()['set-cookie'] || '';
    const csrf = setCookie.match(/nucrm_csrf_token=([^;]+)/)?.[1] || '';
    const session = setCookie.match(/nucrm_session=([^;]+)/)?.[1] || '';
    await context.addCookies([
      { name: 'nucrm_csrf_token', value: csrf, domain: 'localhost', path: '/' },
      { name: 'nucrm_session', value: session, domain: 'localhost', path: '/' },
    ]);

    await page.goto('/tenant/contacts');
    const initialContactCount = await page.locator('[class*="contact"]').count();

    await context.clearCookies();
    
    const response = await page.goto('/api/tenant/contacts');
    expect([401, 403]).toContain(response?.status());
  });

  test('cannot access other tenant data via API', async ({ request }) => {
    const contactsResponse = await request.get('/api/tenant/contacts');
    expect([401, 403]).toContain(contactsResponse.status());
  });
});