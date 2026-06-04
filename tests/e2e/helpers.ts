import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

export async function loginAsTestUser(page: Page) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', TEST_USER.email);
  await page.fill('input[type="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
} EOF
