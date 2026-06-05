import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Authentication', () => {
  test('login page loads with branding', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('h1').first()).toContainText(/Welcome/i);
    await expect(page.getByText('NuCRM').first()).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('signup page loads with form', async ({ page }) => {
    await page.goto('/auth/signup');
    // The form heading is the second h1
    const headings = page.locator('h1');
    await expect(headings.first()).toContainText(/Start/i);
    await expect(headings.nth(1)).toContainText(/Create/i);
    await expect(page.locator('input[placeholder="Acme Corp"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Jane Smith"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('signup validates terms agreement', async ({ page }) => {
    await page.goto('/auth/signup');
    await page.fill('input[placeholder="Acme Corp"]', 'TestCorp');
    await page.fill('input[placeholder="Jane Smith"]', 'Test User');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'StrongP@ss1');
    
    // Button is disabled until terms checked
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    
    // Check terms and verify button enables
    await page.locator('input[type="checkbox"]').check();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test('navigate from login to signup and back', async ({ page }) => {
    await page.goto('/auth/login');
    await page.click('text=Sign up free');
    await expect(page).toHaveURL(/\/auth\/signup/);

    await page.click('a:has-text("Sign in")');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('forgot password link navigates correctly', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/auth\/forgot-password/, { timeout: 10000 });
  });

  test('unauthenticated access to protected route redirects to login', async ({ page }) => {
    await page.goto('/tenant/contacts');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('password strength indicator shows on signup', async ({ page }) => {
    await page.goto('/auth/signup');
    const passwordInput = page.locator('input[type="password"]');
    
    await passwordInput.fill('weak');
    await expect(page.locator('text=Password strength').first()).toBeVisible({ timeout: 3000 });
  });

  test('signup form has all required fields', async ({ page }) => {
    await page.goto('/auth/signup');
    
    // Check visible form fields
    await expect(page.locator('label:has-text("Workspace name")')).toBeVisible();
    await expect(page.locator('label:has-text("Full name")')).toBeVisible();
    await expect(page.locator('label:has-text("Work email")')).toBeVisible();
    await expect(page.locator('label:has-text("Password")')).toBeVisible();
    
    // Check the sign-in link exists
    await expect(page.locator('a:has-text("Sign in")')).toBeVisible();
  });

  test('login has forgot password and signup links', async ({ page }) => {
    await page.goto('/auth/login');
    
    await expect(page.locator('text=Forgot password?')).toBeVisible();
    await expect(page.locator('a:has-text("Sign up free")')).toBeVisible();
  });
});
