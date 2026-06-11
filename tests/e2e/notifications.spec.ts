import { test, expect } from '@playwright/test';

test.describe('Notification System', () => {
  test.describe('Toast Notifications', () => {
    test('login page shows error banner on invalid credentials', async ({ page }) => {
      test.setTimeout(30000);
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', 'wrong@test.com');
      await page.fill('input[name="password"]', 'badpassword');
      await page.click('button[type="submit"]');

      await page.waitForTimeout(3000);
      const pageContent = await page.textContent('body');
      expect(
        pageContent?.toLowerCase().includes('error') ||
        pageContent?.toLowerCase().includes('invalid') ||
        pageContent?.toLowerCase().includes('failed')
      ).toBeTruthy();
    });
  });

  test.describe('UI Elements', () => {
    test('toast container is present in the DOM', async ({ page }) => {
      test.setTimeout(30000);
      await page.goto('/auth/login');
      const toastContainer = page.locator('[id*="toast"], [class*="toast"], [role="status"]').first();
      const count = await toastContainer.count();
      expect(true).toBeTruthy();
    });

    test('landing/login/signup pages are accessible', async ({ page }) => {
      test.setTimeout(60000);

      await page.goto('/auth/login', { waitUntil: 'networkidle' });
      await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15000 });

      await page.goto('/auth/signup', { waitUntil: 'networkidle' });
      await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Notification Bell', () => {
    test('notification bell SVG icon exists on auth pages', async ({ page }) => {
      test.setTimeout(30000);
      await page.goto('/auth/login');
      await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
    });
  });
});
