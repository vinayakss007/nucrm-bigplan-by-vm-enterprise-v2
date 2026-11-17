/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3592 — the seeded plan ids must be the ones the app actually uses. The
 * middle plan was seeded as `professional`, but checkout, the modules registry,
 * Stripe price catalog and billing UI all use `pro`, so the seeded plan could
 * never be resolved (403 "Module not available on your current plan").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const SEED = read('scripts/seed-dev.ts');
const CHECKOUT = read('app/api/tenant/billing/checkout/route.ts');
const REGISTRY = read('lib/modules/registry.ts');
const STRIPE_CATALOG = read('lib/stripe-plan-resolution.ts');

/** The ids the seeder writes into `plans`. */
const seededIds = [...SEED.matchAll(/^\s*id: '([\w-]+)',\s*$/gm)].map((m) => m[1]!);

describe('#3592 the seeded plan ids are canonical', () => {
  it('seeds starter, pro and enterprise — not professional', () => {
    expect(seededIds).toEqual(expect.arrayContaining(['starter', 'pro', 'enterprise']));
    expect(seededIds).not.toContain('professional');
  });

  it('matches the checkout plan enum exactly', () => {
    const enumMatch = CHECKOUT.match(/z\.enum\(\['starter', 'pro', 'enterprise'\]/);
    expect(enumMatch).not.toBeNull();
    for (const id of ['starter', 'pro', 'enterprise']) {
      expect(seededIds, id).toContain(id);
    }
  });

  it('matches the modules registry pricing keys', () => {
    for (const id of ['starter', 'pro', 'enterprise']) {
      expect(REGISTRY, id).toMatch(new RegExp(`\\b${id}:\\{`));
    }
  });

  it('matches the Stripe price catalog', () => {
    for (const id of ['starter', 'pro', 'enterprise']) {
      expect(STRIPE_CATALOG, id).toMatch(new RegExp(`^\\s*${id}: \\[`, 'm'));
    }
  });

  it('keeps the display name while changing only the id and slug', () => {
    expect(SEED).toMatch(/id: 'pro',\s*\n\s*name: 'Professional',\s*\n\s*slug: 'pro',/);
  });
});
