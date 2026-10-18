/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2601 — the `.mk-home` light-ink override recoloured the hero product mock.
 *
 * `app/(marketing)/marketing.css` repaints the marketing homepage light by
 * remapping `.mk-home [class*='text-slate-…']` (and `.mk-home .text-white`) to
 * dark ink. The mock (`.mk-home-product`, `background: #1c1a17`) is a
 * DESCENDANT of `.mk-home`, so its own light text was recoloured to near-black
 * on near-black — measured 1.65:1 on the hero headline mock (was ~15:1 before
 * #2586).
 *
 * The fix is a restore block scoped to `.mk-home .mk-home-product` carrying the
 * original Tailwind values. These tests pin the invariant mechanically: every
 * ink class the remap recolours must have a matching restore rule, and the
 * restored colours must clear contrast against the mock's own background.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'app/(marketing)/marketing.css'), 'utf8');

function contrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
    const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const [a, b] = [lum(hex1), lum(hex2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const MOCK_BG = '#1c1a17';

/** Ink classes the `.mk-home` remap recolours, from anywhere on a selector line. */
const remappedInk = [...new Set(
  [...css.matchAll(/\.mk-home (?:\[class\*='(text-slate-\d+)'\]|\.text-white)/g)]
    .map((m) => m[1] ?? 'text-white'),
)];

/** Restore rules keyed by the ink class they protect inside the mock. */
const restoredInk = new Map<string, string>();
for (const m of css.matchAll(
  /\.mk-home \.mk-home-product (?:\[class\*='([^']+)'\]|\.text-white)\s*\{\s*color:\s*(#[0-9a-f]{3,6})\s*!important/g,
)) {
  restoredInk.set(m[1] ?? 'text-white', m[2]);
}

describe('mk-home ink remap does not touch the dark hero mock (#2601)', () => {
  it('parses the remapped ink classes from the file (cannot silently shrink)', () => {
    expect(remappedInk.length).toBeGreaterThanOrEqual(6);
    expect(remappedInk).toContain('text-slate-100');
    expect(remappedInk).toContain('text-white');
  });

  // The canonical Tailwind values the mock had before #2586 remapped them.
  const TAILWIND: Record<string, string> = {
    'text-white': '#ffffff',
    'text-slate-100': '#f1f5f9',
    'text-slate-200': '#e2e8f0',
    'text-slate-300': '#cbd5e1',
    'text-slate-400': '#94a3b8',
    'text-slate-500': '#64748b',
    'text-slate-600': '#475569',
  };

  for (const cls of remappedInk) {
    it(`restores ${cls} inside .mk-home-product with a higher-specificity rule`, () => {
      const restored = restoredInk.get(cls);
      expect(restored, `missing .mk-home .mk-home-product restore rule for ${cls}`).toBeDefined();
      expect(restored!.toLowerCase()).toBe(TAILWIND[cls]);
      const ratio = contrastRatio(restored!, MOCK_BG);
      // Light ramp = AAA on the mock panel; 400 = AA body; 500/600 are the
      // mock's deliberately-muted metadata tones — they only need to stay
      // brighter than the dark ink the remap would have applied (#454137).
      const floor = cls === 'text-white' || /slate-[123]00/.test(cls) ? 7
        : /slate-400/.test(cls) ? 4.5 : 2;
      expect(ratio, `${cls} restored to ${restored} on ${MOCK_BG} is ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(floor);
    });
  }

  it('the dark mock background itself is unchanged', () => {
    expect(css).toMatch(/\.mk-home-product \{[^}]*background: #1c1a17/);
  });
});
