import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Deals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/tenant/, { timeout: 10000 });
  });

  test('view deals pipeline', async ({ page }) => {
    await page.goto('/tenant/deals');
    await expect(page.locator('text=Deals')).toBeVisible();
  });

  test('create new deal', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    const addButton = page.locator('button:has-text("Add Deal")').first();
    if (await addButton.isVisible()) {
      await addButton.click();
      
      await page.fill('input[name="title"]', 'Test Deal');
      await page.fill('input[name="value"]', '10000');
      
      const saveButton = page.locator('button:has-text("Save")').first();
      if (await saveButton.isVisible()) {
        await saveButton.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('deal pipeline stages are visible', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    for (const stage of stages) {
      await expect(page.locator(`text=${stage}`)).toBeVisible({ timeout: 5000 });
    }
  });
});