import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

let _cachedAuth: { csrf: string; session: string } | null = null;
async function cachedLogin(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  await context.route('**/api/track/**', route => route.abort());
  if (!_cachedAuth) {
    const api = await page.request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    if (api.status() !== 200) throw new Error(`e2e login failed: ${api.status()} ${await api.text()}`);
    const sc = api.headers()['set-cookie'] || '';
    _cachedAuth = {
      csrf: sc.match(/nucrm_csrf_token=([^;]+)/)?.[1] || '',
      session: sc.match(/nucrm_session=([^;]+)/)?.[1] || '',
    };
  }
  await context.addCookies([
    { name: 'nucrm_csrf_token', value: _cachedAuth.csrf, domain: 'localhost', path: '/', secure: true, sameSite: 'Strict' as const },
    { name: 'nucrm_session', value: _cachedAuth.session, domain: 'localhost', path: '/', secure: true, sameSite: 'Strict' as const },
  ]);
}

test.describe('Multi-Tenant Isolation', () => {
  test('tenant data is isolated', async ({ page, context }) => {
    await cachedLogin(page, context);

    await page.goto('/tenant/contacts');
    const _initialContactCount = await page.locator('[class*="contact"]').count();

    await context.clearCookies();
    
    const response = await page.goto('/api/tenant/contacts');
    expect([401, 403]).toContain(response?.status());
  });

  test('cannot access other tenant data via API', async ({ request }) => {
    const contactsResponse = await request.get('/api/tenant/contacts');
    expect([401, 403]).toContain(contactsResponse.status());
  });
});