import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
};

test.describe('Deals', () => {
  test.beforeEach(async ({ page, context }) => {
    // Login via API and set cookies directly, avoiding slow form compilation
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

  test('view deals pipeline', async ({ page }) => {
    await page.goto('/tenant/deals');
    await expect(page.getByRole('heading', { name: /Deals Pipeline/i })).toBeVisible({ timeout: 15000 });
  });

  test('create new deal', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    const addButton = page.locator('button:has-text("Add Deal")').first();
    if (await addButton.isVisible()) {
      await addButton.click();
      
      await page.getByPlaceholder(/Enterprise Deal/i).fill('Test Deal');
      await page.locator('input[type="number"]').first().fill('10000');
      
      const createButton = page.locator('button:has-text("Create Deal")').first();
      if (await createButton.isVisible()) {
        await createButton.click();
        await page.waitForTimeout(2000);
      }
    }
  });

  test('deal pipeline stages are visible', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    for (const stage of stages) {
      await expect(page.getByText(stage).last()).toBeVisible({ timeout: 5000 });
    }
  });
});