import { Page, BrowserContext } from '@playwright/test';

export const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

export async function loginAsTestUser(page: Page) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', TEST_USER.email);
  await page.fill('input[type="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
}

export async function loginWithApi(page: Page, context: BrowserContext) {
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
} EOF
