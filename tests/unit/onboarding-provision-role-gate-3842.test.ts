import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'app/api/tenant/onboarding/route.ts';

function postHandler(): string {
  const src = readFileSync(join(process.cwd(), FILE), 'utf8');
  const start = src.indexOf('export const POST =');
  expect(start, `${FILE} has no POST handler`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nexport const ', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe('onboarding POST tenant-reconfiguration gate (#3842)', () => {
  const handler = postHandler();

  it('rate-limits before authenticating', () => {
    const limitIdx = handler.indexOf('rateLimitMutating(');
    const authIdx = handler.indexOf('requireAuth(');
    expect(limitIdx).toBeGreaterThanOrEqual(0);
    expect(limitIdx).toBeLessThan(authIdx);
  });

  it('requires settings.manage after requireAuth', () => {
    const authIdx = handler.indexOf('requireAuth(');
    const gateIdx = handler.indexOf("requirePerm(ctx, 'settings.manage')");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThan(authIdx);
  });

  it('gates before any tenant-wide mutation', () => {
    const gateIdx = handler.indexOf("requirePerm(ctx, 'settings.manage')");
    for (const mutation of ['installTemplateModules(', 'db.transaction(']) {
      const idx = handler.indexOf(mutation);
      expect(idx, `${mutation} missing from POST`).toBeGreaterThanOrEqual(0);
      expect(gateIdx).toBeLessThan(idx);
    }
  });
});
