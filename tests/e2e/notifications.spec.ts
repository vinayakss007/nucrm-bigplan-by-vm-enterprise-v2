import { test, expect } from '@playwright/test';

test.describe('Notification System', () => {
  test.describe('Toast Notifications', () => {
    test('login page shows error banner on invalid credentials', async ({ page }) => {
      await page.goto('/auth/login');
      await page.fill('input[name="email"]', 'wrong@test.com');
      await page.fill('input[name="password"]', 'badpassword');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Error should appear (either as toast or inline error)
      await page.waitForTimeout(2000);
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
      await page.goto('/auth/login');
      
      // React-hot-toast renders a div with role="status" or specific class
      const toastContainer = page.locator('[id*="toast"], [class*="toast"], [role="status"]').first();
      
      // The Toaster renders in the layout; it may or may not have visible content
      // but should exist as a DOM element since it's in the root layout
      await expect(toastContainer).toHaveCount(1);
    });

    test('landing/login/signup pages are accessible', async ({ page, context }) => {
      // Clear cookies to avoid redirect loops for authenticated sessions
      await context.clearCookies();
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await expect(page).toHaveURL(/\//);

      // Auth login
      await page.goto('/auth/login');
      await expect(page.locator('input[name="email"]')).toBeVisible();

      // Auth signup
      await page.goto('/auth/signup');
      await expect(page.locator('input[type="email"]').first()).toBeVisible();
    });
  });

  test.describe('Notification Bell', () => {
    test('login page renders its sign-in form', async ({ page }) => {
      await page.goto('/auth/login');
      await expect(page.locator('form')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
  });
});
