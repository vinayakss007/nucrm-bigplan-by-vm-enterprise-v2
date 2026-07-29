/**
 * Capture screenshots of the marketing site for design review.
 *
 * Uses reducedMotion: 'reduce' so the IntersectionObserver reveal animations
 * resolve immediately (marketing.css keeps .mk-reveal fully visible under that
 * media query) and the counters render their final values. Without it, any
 * section that was never scrolled into view would capture as blank.
 *
 * Run against an already-running production server:
 *   node scripts/marketing-screenshots.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3111';
const OUT = process.argv[3] ?? '.kiro/artifacts/screenshots';

const shots = [
  // Desktop viewport crops — what a visitor sees before scrolling.
  { name: '01-landing-hero-desktop', path: '/', width: 1440, height: 900, scale: 2 },
  { name: '02-landing-full-desktop', path: '/', width: 1360, height: 900, fullPage: true },
  { name: '03-landing-hero-mobile', path: '/', width: 390, height: 844, scale: 2 },
  { name: '04-features-hub', path: '/features', width: 1360, height: 1000, fullPage: false, scrollTo: 500 },
  { name: '05-feature-ai', path: '/features/ai', width: 1360, height: 1000 },
  { name: '06-solution-real-estate', path: '/solutions/real-estate', width: 1360, height: 1000, scrollTo: 1500 },
  { name: '07-compare-hubspot', path: '/compare/hubspot', width: 1360, height: 1000 },
  { name: '08-pricing', path: '/pricing', width: 1360, height: 1000, scrollTo: 420 },
  { name: '09-abetworks-studio', path: '/abetworks', width: 1360, height: 1000, scrollTo: 2600 },
  { name: '10-footer', path: '/', width: 1360, height: 1000, scrollTo: 'bottom' },
];

async function primeReveals(page) {
  // Walk the page so every observer fires, then return to the requested offset.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
  });
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir(OUT, { recursive: true });

for (const s of shots) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.scale ?? 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const response = await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle', timeout: 60000 });
  if (!response || !response.ok()) {
    console.error(`FAILED ${s.path} — status ${response?.status() ?? 'no response'}`);
    await context.close();
    continue;
  }
  await primeReveals(page);

  if (s.scrollTo === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
  } else if (typeof s.scrollTo === 'number') {
    await page.evaluate((y) => window.scrollTo(0, y), s.scrollTo);
    await page.waitForTimeout(400);
  }

  const file = `${OUT}/${s.name}.png`;
  await page.screenshot({ path: file, fullPage: Boolean(s.fullPage) });
  console.log(`${file}  ${s.path}  ${s.width}x${s.height}${s.fullPage ? ' fullPage' : ''}`);
  await context.close();
}

await browser.close();
console.log('done');
