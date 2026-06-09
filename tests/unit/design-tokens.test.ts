import { describe, it, expect } from 'vitest';
import {
  colors, spacing, typography, shadows, borderRadius, zIndex,
  transitions, breakpoints, button, input, card, badge,
  getContrastText, rgba,
} from '@/lib/design-tokens';
import defaultExport from '@/lib/design-tokens';

describe('colors', () => {
  it('has primary palette', () => {
    expect(colors.primary[500]).toBe('#a855f7');
    expect(colors.primary[600]).toBe('#9333ea');
  });

  it('has success palette', () => {
    expect(colors.success[500]).toBe('#10b981');
  });

  it('has warning palette', () => {
    expect(colors.warning[500]).toBe('#f59e0b');
  });

  it('has error palette', () => {
    expect(colors.error[500]).toBe('#ef4444');
  });

  it('has info palette', () => {
    expect(colors.info[500]).toBe('#3b82f6');
  });

  it('has gray palette', () => {
    expect(colors.gray[50]).toBe('#f8fafc');
    expect(colors.gray[900]).toBe('#0f172a');
  });

  it('has utility colors', () => {
    expect(colors.white).toBe('#ffffff');
    expect(colors.black).toBe('#000000');
    expect(colors.transparent).toBe('transparent');
  });
});

describe('spacing', () => {
  it('has defined values', () => {
    expect(spacing.unit).toBe(4);
    expect(spacing.none).toBe(0);
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(16);
    expect(spacing.xl).toBe(32);
    expect(spacing['4xl']).toBe(64);
  });
});

describe('typography', () => {
  it('has font family definitions', () => {
    expect(typography.fontFamily.sans).toContain('Inter');
    expect(typography.fontFamily.mono).toContain('JetBrains');
  });

  it('has font size scale', () => {
    expect(typography.fontSize.xs).toBe('0.75rem');
    expect(typography.fontSize.base).toBe('1rem');
    expect(typography.fontSize['5xl']).toBe('3rem');
  });

  it('has font weights', () => {
    expect(typography.fontWeight.normal).toBe(400);
    expect(typography.fontWeight.bold).toBe(700);
  });

  it('has line heights', () => {
    expect(typography.lineHeight.none).toBe(1);
    expect(typography.lineHeight.relaxed).toBe(1.75);
  });
});

describe('shadows', () => {
  it('has shadow definitions', () => {
    expect(shadows.sm).toContain('rgb');
    expect(shadows.md).toContain('rgb');
    expect(shadows.none).toBe('none');
  });
});

describe('borderRadius', () => {
  it('has radius values', () => {
    expect(borderRadius.none).toBe('0');
    expect(borderRadius.md).toBe('0.5rem');
    expect(borderRadius.full).toBe('9999px');
  });
});

describe('zIndex', () => {
  it('has z-index scale', () => {
    expect(zIndex.hide).toBe(-1);
    expect(zIndex.base).toBe(0);
    expect(zIndex.modal).toBe(1400);
    expect(zIndex.toast).toBe(1700);
  });
});

describe('transitions', () => {
  it('has duration values', () => {
    expect(transitions.duration.fast).toBe('150ms');
    expect(transitions.duration.slow).toBe('300ms');
  });

  it('has timing functions', () => {
    expect(transitions.timing.easeInOut).toBe('ease-in-out');
  });
});

describe('breakpoints', () => {
  it('has responsive breakpoints', () => {
    expect(breakpoints.sm).toBe('640px');
    expect(breakpoints.lg).toBe('1024px');
    expect(breakpoints['2xl']).toBe('1536px');
  });
});

describe('button', () => {
  it('has variant definitions', () => {
    expect(button.variants.primary.bg).toBe(colors.primary[600]);
    expect(button.variants.danger.bg).toBe(colors.error[600]);
    expect(button.variants.success.text).toBe(colors.white);
  });

  it('has size definitions', () => {
    expect(button.sizes.sm.fontSize).toBe(typography.fontSize.xs);
    expect(button.sizes.lg.fontSize).toBe(typography.fontSize.base);
  });
});

describe('input', () => {
  it('has input tokens', () => {
    expect(input.borderColor).toBe(colors.gray[300]);
    expect(input.borderColorFocus).toBe(colors.primary[500]);
    expect(input.errorColor).toBe(colors.error[500]);
    expect(input.borderRadius).toBe(borderRadius.md);
  });
});

describe('card', () => {
  it('has card tokens', () => {
    expect(card.bgColor).toBe(colors.white);
    expect(card.borderRadius).toBe(borderRadius.lg);
    expect(card.shadow).toBe(shadows.md);
  });
});

describe('badge', () => {
  it('has variant definitions', () => {
    expect(badge.variants.default.bg).toBe(colors.gray[100]);
    expect(badge.variants.primary.text).toBe(colors.primary[700]);
    expect(badge.variants.error.bg).toBe(colors.error[100]);
  });
});

describe('getContrastText', () => {
  it('returns dark text for light backgrounds', () => {
    expect(getContrastText('#ffffff')).toBe(colors.gray[900]);
  });

  it('returns white text for dark backgrounds', () => {
    expect(getContrastText('#000000')).toBe(colors.white);
  });

  it('returns dark text for medium gray', () => {
    expect(getContrastText('#cccccc')).toBe(colors.gray[900]);
  });
});

describe('rgba', () => {
  it('converts hex to rgba string', () => {
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('handles 3-byte hex codes', () => {
    const result = rgba('#a855f7', 0.3);
    expect(result).toMatch(/^rgba\(\d+, \d+, \d+, 0\.3\)$/);
  });

  it('handles alpha of 1', () => {
    expect(rgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });
});

describe('default export', () => {
  it('includes all named exports', () => {
    expect(defaultExport.colors).toBe(colors);
    expect(defaultExport.spacing).toBe(spacing);
    expect(defaultExport.getContrastText).toBe(getContrastText);
    expect(defaultExport.rgba).toBe(rgba);
  });
});
