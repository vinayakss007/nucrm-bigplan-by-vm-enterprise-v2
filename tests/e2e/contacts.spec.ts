import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: process.env.SEED_PASSWORD ?? '',
};


let _cachedAuth: { csrf: string; session: string } | null = null;
async function cachedLogin(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  await context.route('**/api/track/**', route => route.abort());
  if (!_cachedAuth) {
    const api = await page.request.post('/api/auth/login', {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    if (api.status() !== 200) throw new Error(`e2e login failed: ${api.status()} ${await api.text()}`);
    const sc = api.headers()['set-cookie'] || '';
    _cachedAuth = {
      csrf: sc.match(/nucrm_csrf_token=([^;]+)/)?.[1] || '',
      session: sc.match(/nucrm_session=([^;]+)/)?.[1] || '',
    };
  }
  await context.addCookies([
    { name: 'nucrm_csrf_token', value: _cachedAuth.csrf, domain: 'localhost', path: '/', secure: true, sameSite: 'Strict' as const },
    { name: 'nucrm_session', value: _cachedAuth.session, domain: 'localhost', path: '/', secure: true, sameSite: 'Strict' as const },
  ]);
}

test.describe('Contacts', () => {
  test.beforeEach(async ({ page, context }) => {
    await cachedLogin(page, context);
  });

  test('view contacts list', async ({ page }) => {
    await page.goto('/tenant/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible({ timeout: 15000 });
  });

  test('search contacts', async ({ page }) => {
    await page.goto('/tenant/contacts');
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test');
    await expect(searchInput).toHaveValue('test');
  });

  test('create new contact', async ({ page }) => {
    await page.goto('/tenant/contacts');
    
    const addButton = page.getByRole('button', { name: 'New Contact' }).first();
    await expect(addButton).toBeVisible();
    await addButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input').nth(0).fill('Test');
    await dialog.locator('input').nth(1).fill('User');
    await dialog.locator('input').nth(2).fill('testuser@example.com');

    const submitBtn = dialog.getByRole('button', { name: 'Add Contact' });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();
    await expect(dialog).toBeHidden();
  });

  test('contact detail page loads', async ({ page }) => {
    await page.goto('/tenant/contacts');
    
    const nameCell = page.locator('table tbody tr').first().locator('td').nth(1);
    await expect(nameCell).toBeVisible();
    for (let attempt = 0; attempt < 3 && page.url().endsWith('/tenant/contacts'); attempt++) {
      await nameCell.click();
      await page.waitForTimeout(300);
    }
    await expect(page).toHaveURL(/\/tenant\/contacts\/[^/]+$/, { timeout: 5000 });
    await expect(page.locator('h1').first()).toBeVisible();
  });
});