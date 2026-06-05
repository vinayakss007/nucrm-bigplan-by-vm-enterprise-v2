import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Contacts', () => {
  test.beforeEach(async ({ page, context }) => {
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
  });

  test('view contacts list', async ({ page }) => {
    await page.goto('/tenant/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible({ timeout: 15000 });
  });

  test('search contacts', async ({ page }) => {
    await page.goto('/tenant/contacts');
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
    }
  });

  test('create new contact', async ({ page }) => {
    await page.goto('/tenant/contacts');
    
    const addButton = page.locator('button:has-text("Add Contact")').first();
    if (await addButton.isVisible()) {
      await addButton.click();
      
      await page.locator('form input').first().fill('Test');
      await page.locator('form input').nth(1).fill('User');
      await page.locator('form input').nth(2).fill('testuser@example.com');
      
      const submitBtn = page.getByRole('dialog').getByRole('button', { name: 'Add Contact' });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }
    }
  });

  test('contact detail page loads', async ({ page }) => {
    await page.goto('/tenant/contacts');
    
    const firstContact = page.locator('a[href*="/tenant/contacts/"]').first();
    if (await firstContact.isVisible()) {
      await firstContact.click();
      await expect(page.getByRole('heading', { name: 'Contact Details' })).toBeVisible({ timeout: 5000 });
    }
  });
});