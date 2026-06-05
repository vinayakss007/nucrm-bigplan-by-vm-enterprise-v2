import { test, expect } from '@playwright/test';

test.describe('NuCRM Smoke Tests', () => {
  test('auth pages are accessible', async ({ page }) => {
    // Login page
    await page.goto('/auth/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    // Signup page
    await page.goto('/auth/signup');
    await expect(page.locator('input[placeholder="Acme Corp"]')).toBeVisible();
    
    // Forgot password page
    await page.goto('/auth/forgot-password');
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('navigates between auth pages', async ({ page }) => {
    await page.goto('/auth/login');
    
    // Login → Signup
    await page.click('a:has-text("Sign up free")');
    await expect(page).toHaveURL(/\/auth\/signup/);
    
    // Signup → Login
    await page.click('a:has-text("Sign in")');
    await expect(page).toHaveURL(/\/auth\/login/);
    
    // Login → Forgot password
    await page.click('text=Forgot password');
    await expect(page).toHaveURL(/\/auth\/forgot-password/);
  });
});
