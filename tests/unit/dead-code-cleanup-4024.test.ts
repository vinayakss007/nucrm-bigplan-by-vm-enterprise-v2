import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('dead-code cleanup (#4024)', () => {
  it('removes the overwritten candidates initialisation', () => {
    const source = read('lib/assignment.ts');
    expect(source).not.toContain('let candidates = scored;');
    expect(source).toContain("const candidates = matchMode === 'all'");
  });

  it('removes the overwritten safeAuthConfig initialisation', () => {
    const source = read('app/api/tenant/plugins/[id]/route.ts');
    expect(source).not.toContain('let safeAuthConfig: unknown = plugin.authConfig;');
    expect(source).toContain('let safeAuthConfig: unknown;');
    expect(source).toContain('authConfig: safeAuthConfig');
  });

  it('removes the unreachable second return in the usage tracker', () => {
    const source = read('lib/usage/tracker.ts');
    expect(source).not.toContain('return { created: true };');
    expect(source.match(/return \{ created \};/g)).toHaveLength(1);
  });

  it('keeps the BaseHTTPRequestHandler overrides the scanner misread as unused', () => {
    const source = read('deploy/monitoring/alert-webhook.py');
    expect(source).toContain('def do_POST(self):');
    expect(source).toContain('def log_message(self, format, *args):');
  });
});
