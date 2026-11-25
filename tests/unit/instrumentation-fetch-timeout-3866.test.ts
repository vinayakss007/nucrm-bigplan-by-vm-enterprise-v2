import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'instrumentation.ts'), 'utf8');
const start = src.indexOf("fetch(`https://api.telegram.org/bot${botToken}/setWebhook`");
const call = src.slice(start, src.indexOf('}).then', start));

describe('boot-time Telegram fetch is bounded (#3866)', () => {
  it('carries an abort timeout', () => {
    expect(call).toContain('signal: AbortSignal.timeout(5000)');
  });

  it('keeps the non-blocking registration and failure logging', () => {
    expect(src).toContain('}).then(r => r.json()).then(d => {');
    expect(src).toContain("console.error('[instrumentation] Telegram webhook registration failed:'");
  });
});
