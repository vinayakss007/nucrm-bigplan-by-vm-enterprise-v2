/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the automation page's three mutations (prebuilt toggle, custom
 * toggle, custom delete) used to `await fetch(...)` with the response discarded,
 * so a refused request still flashed "Automation enabled" / "Deleted".
 * This screen pins that each mutation checks `res.ok` before celebrating, so a
 * future edit that drops the check turns CI red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const src = readFileSync(join(ROOT, 'app/tenant/automation/page.tsx'), 'utf8');

/** Body of one `useMutation({ mutationFn: ... })` block, by its variable name. */
function mutationFn(name: string): string {
  const start = src.indexOf(`const ${name} = useMutation`);
  if (start < 0) return '';
  const rest = src.slice(start);
  const next = rest.indexOf('\n  const ', 5);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('automation mutations surface failures instead of false success (#3408)', () => {
  for (const name of ['togglePrebuiltMutation', 'toggleCustomMutation', 'deleteCustomMutation']) {
    it(`${name} checks the response before onSuccess`, () => {
      const block = mutationFn(name);
      expect(block, `${name} not found`).not.toBe('');
      expect(block, `${name} discards the fetch response`).toMatch(/const res = await fetch\(/);
      expect(block, `${name} never checks res.ok`).toMatch(/if \(!res\.ok\)/);
      expect(block, `${name} has no error toast`).toMatch(/onError:/);
    });
  }

  it('there are no bare awaited fetches left on the page', () => {
    expect(src).not.toMatch(/^\s*await fetch\(/m);
  });
});
