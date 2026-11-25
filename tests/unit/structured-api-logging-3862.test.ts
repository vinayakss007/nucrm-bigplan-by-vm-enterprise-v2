import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...routeFiles(path));
    else if (entry === 'route.ts') out.push(path);
  }
  return out;
}

describe('server API routes log through logError (#3862)', () => {
  const routes = routeFiles(join(process.cwd(), 'app/api'));

  it('has no raw console.error or console.warn on the server path', () => {
    const offenders: string[] = [];
    for (const file of routes) {
      if (file.endsWith('embed/form.js/route.ts')) continue;
      const src = readFileSync(file, 'utf8');
      if (/console\.(error|warn)\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('routes the Resend warnings and the v1 deprecation notice to logError', () => {
    const resend = readFileSync(join(process.cwd(), 'app/api/webhooks/resend/route.ts'), 'utf8');
    const v1 = readFileSync(join(process.cwd(), 'app/api/v1/auth/route.ts'), 'utf8');
    expect(resend).toContain("context: 'webhooks/resend'");
    expect(resend).toContain("context: 'webhooks/resend attribution'");
    expect(resend).toContain("level: 'warning', captureToSentry: false");
    expect(v1).toContain("context: 'v1/auth login'");
  });
});
