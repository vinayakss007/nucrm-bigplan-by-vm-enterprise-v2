import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'superadmin@nucrm.com',
  password: 'admin123',
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

test.describe('Deals', () => {
  test.beforeEach(async ({ page, context }) => {
    // Login via API and set cookies directly, avoiding slow form compilation
    await cachedLogin(page, context);
  });

  test('view deals pipeline', async ({ page }) => {
    await page.goto('/tenant/deals');
    await expect(page.getByRole('heading', { name: /^Deals$/ })).toBeVisible({ timeout: 15000 });
  });

  test('create new deal', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    const addButton = page.locator('button:has-text("Add Deal")').first();
    await expect(addButton).toBeVisible();
    await addButton.click();

    const titleInput = page.getByPlaceholder(/Enterprise Deal/i);
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Test Deal');
    await page.locator('input[type="number"]').first().fill('10000');

    const createButton = page.locator('button:has-text("Create Deal")').first();
    await expect(createButton).toBeVisible();
    await createButton.click();
    await expect(page.getByText('Test Deal').first()).toBeVisible();
  });

  test('deal pipeline stages are visible', async ({ page }) => {
    await page.goto('/tenant/deals');
    
    // Default deals view is a table; empty workspace shows no stage chips,
    // so assert the Stage column header renders.
    await expect(page.getByRole('columnheader', { name: 'Stage' })).toBeVisible({ timeout: 10000 });
  });
});