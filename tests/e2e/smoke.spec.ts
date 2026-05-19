import { test, expect } from '@playwright/test';

test.describe('NuCRM Smoke Tests', () => {
  test('should load the landing page', async ({ page }) => {
    await page.goto('/');
    
    // Check for the brand name (first occurrence)
    await expect(page.locator('text=NuCRM').first()).toBeVisible();
    
    // Check for the main CTA
    const getStarted = page.locator('text=Get Started').first();
    await expect(getStarted).toBeVisible();
  });

  test('should navigate to signup page', async ({ page }) => {
    await page.goto('/');
    
    const getStarted = page.locator('text=Get Started').first();
    await getStarted.click();
    
    // Check if we are on the signup page
    await expect(page).toHaveURL(/\/auth\/signup/);
    await expect(page.locator('h1')).toContainText(/Create/i);
  });
});
