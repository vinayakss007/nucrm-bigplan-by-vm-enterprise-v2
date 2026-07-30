/**
 * Section-level captures for design review.
 *
 * The full-page landing screenshot is ~9000px tall, so it is unreadable once
 * scaled down. This grabs each section as its own image instead, plus two
 * interaction states (mega menu open, mobile drawer open) that a static page
 * capture cannot show.
 *
 *   node scripts/marketing-sections.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3112';
const OUT = process.argv[3] ?? '.kiro/artifacts/screenshots';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir(OUT, { recursive: true });

async function openPage({ width = 1440, height = 950, scale = 1.5, path = '/' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
  // Walk the page so every IntersectionObserver has fired.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  return { context, page };
}

/* ── landing sections, captured as elements ───────────────────────────── */
{
  const { context, page } = await openPage();

  // Sections that carry an id, plus the two that do not (found by position).
  const targets = [
    ['11-stack-consolidation', '#why'],
    ['11b-stats', '#scale'],
    ['12-bento-capabilities', '#features'],
    ['13-product-tour', '#tour'],
    ['14-integrations', '#integrations'],
    ['15-compare-table', '#compare'],
    ['16-pricing-preview', '#pricing'],
    ['17-faq', '#faq'],
  ];

  for (const [name, selector] of targets) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) {
      console.log(`skip ${name} (${selector} not found)`);
      continue;
    }
    // Scroll so the section starts below the fixed header, otherwise the
    // capture shows the nav sitting on top of the section's own eyebrow.
    await el.evaluate((node) => {
      const y = node.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo(0, Math.max(0, y));
    });
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${OUT}/${name}.png  ${selector}`);
  }
  await context.close();
}

/* ── mega menu open ───────────────────────────────────────────────────── */
{
  const { context, page } = await openPage();
  await page.getByRole('button', { name: 'Product' }).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/18-mega-menu-product.png`, clip: { x: 0, y: 0, width: 1440, height: 520 } });
  console.log(`${OUT}/18-mega-menu-product.png`);
  await context.close();
}

/* ── mobile: drawer open + a scrolled section ─────────────────────────── */
{
  const { context, page } = await openPage({ width: 390, height: 844, scale: 2 });
  await page.getByLabel('Open menu').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Solutions' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/19-mobile-menu.png` });
  console.log(`${OUT}/19-mobile-menu.png`);
  await context.close();
}
{
  const { context, page } = await openPage({ width: 390, height: 844, scale: 2 });
  const el = page.locator('#pricing').first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/20-mobile-pricing.png` });
  console.log(`${OUT}/20-mobile-pricing.png`);
  await context.close();
}

/* ── wide monitor sanity check ────────────────────────────────────────── */
{
  const { context, page } = await openPage({ width: 1920, height: 1000, scale: 1 });
  await page.screenshot({ path: `${OUT}/21-hero-1920.png` });
  console.log(`${OUT}/21-hero-1920.png`);
  await context.close();
}

await browser.close();
console.log('done');
