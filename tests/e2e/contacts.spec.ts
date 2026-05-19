import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/tenant/, { timeout: 10000 });
  });

  test('view contacts list', async ({ page }) => {
    await page.goto('/tenant/contacts');
    await expect(page.locator('text=Contacts')).toBeVisible();
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
      
      await page.fill('input[name="first_name"]', 'Test');
      await page.fill('input[name="last_name"]', 'User');
      await page.fill('input[name="email"]', 'testuser@example.com');
      
      const saveButton = page.locator('button:has-text("Save")').first();
      if (await saveButton.isVisible()) {
        await saveButton.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('contact detail page loads', async ({ page }) => {
    await page.goto('/tenant/contacts');
    
    const firstContact = page.locator('a[href*="/tenant/contacts/"]').first();
    if (await firstContact.isVisible()) {
      await firstContact.click();
      await expect(page.locator('text=Contact Details')).toBeVisible({ timeout: 5000 });
    }
  });
});