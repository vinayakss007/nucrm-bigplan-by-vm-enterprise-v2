import { test } from '@playwright/test';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

interface AuditError {
  url: string;
  type: string;
  text?: string;
  status?: number;
  endpoint?: string;
}

async function crawlPage(url: string, visited: Set<string>, errors: AuditError[]) {
  if (visited.has(url)) return;
  visited.add(url);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({ url, type: 'console_error', text: msg.text() });
    if (msg.text().includes('404') || msg.text().includes('Failed to load'))
      errors.push({ url, type: 'fetch_fail', text: msg.text() });
  });

  page.on('pageerror', err => errors.push({ url, type: 'page_crash', text: err.message }));

  page.on('response', resp => {
    if (resp.status() >= 400)
      errors.push({ url, type: 'http_error', status: resp.status(), endpoint: resp.url() });
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    const links = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
    for (const link of links) {
      if (link.startsWith(BASE) && !visited.has(link)) {
        await crawlPage(link, visited, errors);
      }
    }
  } catch (e) {
    errors.push({ url, type: 'crawl_fail', text: (e as Error).message });
  }

  await browser.close();
}

test('runtime audit', async () => {
  const visited = new Set<string>();
  const errors: AuditError[] = [];

  // Start from login page
  await crawlPage(`${BASE}/auth/login`, visited, errors);

  // Check health and API endpoints
  const apiEndpoints = ['/api/health', '/api/setup/status', '/api/auth/login'];
  for (const ep of apiEndpoints) {
    try {
      const resp = await fetch(`${BASE}${ep}`);
      if (resp.status >= 400)
        errors.push({ url: `${BASE}${ep}`, type: 'api_fail', status: resp.status });
    } catch (e) {
      errors.push({ url: `${BASE}${ep}`, type: 'api_crash', text: (e as Error).message });
    }
  }

  console.log('\n=== AUDIT RESULTS ===');
  console.log(`Pages crawled: ${visited.size}`);
  console.log(`Errors found: ${errors.length}`);

  const byType: Record<string, number> = {};
  for (const e of errors) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    console.log(`  [${e.type}] ${e.url} — ${e.text || e.status || ''}`);
  }
  console.log('\nError breakdown:', byType);
});
