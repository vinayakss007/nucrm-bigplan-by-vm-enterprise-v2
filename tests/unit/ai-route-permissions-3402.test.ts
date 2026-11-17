/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 — the `ai.use` id and the four gates that enforce it.
 *
 * Every AI handler authenticated the caller and checked the plan/module, but
 * never asked what role they held: any member could spend the tenant's provider
 * budget. The vocabulary guard proves the id is enforced somewhere; this spec
 * pins WHICH handler asks for it, that the gate precedes the provider call,
 * and the default-role grants that make the check meaningful for non-admins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@/lib/permissions/definitions';

const ROOT = join(import.meta.dirname!, '..', '..');
const source = (p: string) => readFileSync(join(ROOT, 'app/api/tenant/ai', p), 'utf8');

/** The gate inside the exported handler, read from the handler's own block. */
function gateOf(file: string): string | null {
  const text = source(file);
  const start = text.indexOf('export const POST = ');
  if (start < 0) return null;
  const rest = text.slice(start);
  const next = rest.indexOf('\nexport const ', 1);
  const block = next < 0 ? rest : rest.slice(0, next);
  return block.match(/requirePerm\(ctx, '([^']+)'\)/)?.[1] ?? null;
}

const ROUTES = ['route.ts', 'draft/route.ts', 'sentiment/route.ts', 'summarize/route.ts'];

describe('AI route role gates (#3402)', () => {
  it.each(ROUTES)('%s asks for ai.use in POST', (file) => {
    expect(gateOf(file), file).toBe('ai.use');
  });

  it('checks the role before the plan gate and before any provider call', () => {
    for (const file of ROUTES) {
      const text = source(file);
      const post = text.slice(text.indexOf('export const POST = '));
      const gate = post.indexOf('requirePerm(ctx, \'ai.use\')');
      expect(gate, `${file} has no gate`).toBeGreaterThan(-1);
      const feature = post.indexOf('requireAiFeature(');
      if (feature >= 0) expect(gate, `${file} gates after the plan gate`).toBeLessThan(feature);
    }
  });

  it('declares ai.use in the Roles-UI catalog as a moderate capability', () => {
    const perm = PERMISSIONS.find((p) => p.id === 'ai.use');
    expect(perm).toBeDefined();
    expect(perm!.dangerLevel).toBe('moderate');
  });

  it('grants the AI assistant to admins, managers and reps, not viewers', () => {
    expect(DEFAULT_ROLE_PERMISSIONS['admin']['ai.use']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS['manager']['ai.use']).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS['sales_rep']['ai.use']).toBe(true);
    // viewer is derived from PERMISSIONS and only receives .view/.view_all ids.
    expect(DEFAULT_ROLE_PERMISSIONS['viewer']['ai.use']).toBe(false);
  });

  it('the four routes left the shrink-only ungated baseline', () => {
    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'scripts/mutating-route-permissions-baseline.json'), 'utf8'),
    ) as { files: string[] };
    for (const file of ROUTES) {
      expect(baseline.files).not.toContain(`app/api/tenant/ai/${file}`);
    }
  });
});
