import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: {
    id: 'id',
    logoUrl: 'logo_url',
    faviconUrl: 'favicon_url',
    primaryColor: 'primary_color',
    customDomain: 'custom_domain',
    name: 'name',
    settings: 'settings',
  },
}));

describe('Branding Engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('generateCSSVariables', () => {
    it('produces valid CSS with brand colors', async () => {
      const { generateCSSVariables } = await import('@/lib/branding');

      const config = {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#7c3aed',
        secondaryColor: '#6366f1',
        accentColor: '#f59e0b',
        companyName: 'Test Corp',
        customDomain: null,
        hidePoweredBy: false,
        customCss: null,
        headerLayout: 'default' as const,
      };

      const css = generateCSSVariables(config);
      expect(css).toContain(':root');
      expect(css).toContain('--brand-primary: #7c3aed;');
      expect(css).toContain('--brand-secondary: #6366f1;');
      expect(css).toContain('--brand-accent: #f59e0b;');
    });

    it('includes logo URL as CSS variable when provided', async () => {
      const { generateCSSVariables } = await import('@/lib/branding');

      const config = {
        logoUrl: 'https://example.com/logo.png',
        faviconUrl: null,
        primaryColor: '#000000',
        secondaryColor: '#111111',
        accentColor: '#222222',
        companyName: null,
        customDomain: null,
        hidePoweredBy: false,
        customCss: null,
        headerLayout: 'default' as const,
      };

      const css = generateCSSVariables(config);
      expect(css).toContain('--brand-logo-url: url(https://example.com/logo.png);');
    });

    it('includes custom CSS when provided', async () => {
      const { generateCSSVariables } = await import('@/lib/branding');

      const config = {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#000000',
        secondaryColor: '#111111',
        accentColor: '#222222',
        companyName: null,
        customDomain: null,
        hidePoweredBy: false,
        customCss: '.custom-class { color: red; }',
        headerLayout: 'default' as const,
      };

      const css = generateCSSVariables(config);
      expect(css).toContain('.custom-class { color: red; }');
    });

    it('produces valid CSS without optional fields', async () => {
      const { generateCSSVariables } = await import('@/lib/branding');

      const config = {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
        accentColor: '#0000ff',
        companyName: null,
        customDomain: null,
        hidePoweredBy: false,
        customCss: null,
        headerLayout: 'minimal' as const,
      };

      const css = generateCSSVariables(config);
      expect(css).toContain(':root');
      expect(css).toContain('--brand-primary: #ff0000;');
      expect(css).not.toContain('--brand-logo-url');
    });
  });

  describe('validateCustomDomain', () => {
    it('accepts valid domains', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      expect(validateCustomDomain('crm.example.com')).toEqual({ valid: true });
      expect(validateCustomDomain('my-app.company.io')).toEqual({ valid: true });
      expect(validateCustomDomain('sub.domain.co.uk')).toEqual({ valid: true });
    });

    it('rejects empty string', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects domains with protocol', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('https://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('protocol');
    });

    it('rejects domains with path', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('example.com/path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path');
    });

    it('rejects domains with spaces', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('exam ple.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('spaces');
    });

    it('rejects invalid domain format', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      expect(validateCustomDomain('notadomain').valid).toBe(false);
      expect(validateCustomDomain('.com').valid).toBe(false);
      expect(validateCustomDomain('a').valid).toBe(false);
    });

    it('rejects reserved domains', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('nucrm.io');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved');
    });
  });

  describe('DEFAULT_BRANDING', () => {
    it('has expected default values', async () => {
      const { DEFAULT_BRANDING } = await import('@/lib/branding');

      expect(DEFAULT_BRANDING.primaryColor).toBe('#7c3aed');
      expect(DEFAULT_BRANDING.secondaryColor).toBe('#6366f1');
      expect(DEFAULT_BRANDING.accentColor).toBe('#f59e0b');
      expect(DEFAULT_BRANDING.hidePoweredBy).toBe(false);
      expect(DEFAULT_BRANDING.headerLayout).toBe('default');
      expect(DEFAULT_BRANDING.logoUrl).toBeNull();
      expect(DEFAULT_BRANDING.customCss).toBeNull();
    });
  });
});
