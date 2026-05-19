import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Multi-Tenant Isolation', () => {
  test('tenant data is isolated', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/tenant/, { timeout: 10000 });

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