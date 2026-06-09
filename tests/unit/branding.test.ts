import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelectResult: any[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => mockDbSelectResult),
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

import { eq } from 'drizzle-orm';
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any, b: any) => ({ a, b })),
}));

describe('Branding Engine', () => {
  beforeEach(() => {
    vi.resetModules();
    mockDbSelectResult.length = 0;
    mockDbSelectResult.push({
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
      customDomain: null,
      name: 'Test Corp',
      settings: {},
    });
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

    it('sanitizes custom CSS when included', async () => {
      const { generateCSSVariables } = await import('@/lib/branding');

      const config = {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#000',
        secondaryColor: '#111',
        accentColor: '#222',
        companyName: null,
        customDomain: null,
        hidePoweredBy: false,
        customCss: "</style><script>alert('xss')</script>",
        headerLayout: 'default' as const,
      };

      const css = generateCSSVariables(config);
      expect(css).not.toContain('<script>');
      expect(css).not.toContain('</style>');
    });
  });

  describe('validateCustomDomain', () => {
    it('accepts valid domains', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      expect(validateCustomDomain('crm.example.com')).toEqual({ valid: true });
      expect(validateCustomDomain('my-app.company.io')).toEqual({ valid: true });
      expect(validateCustomDomain('sub.domain.co.uk')).toEqual({ valid: true });
    });

    it('rejects null/undefined', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      expect(validateCustomDomain(null as any).valid).toBe(false);
      expect(validateCustomDomain(undefined as any).valid).toBe(false);
    });

    it('rejects empty string', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      const result = validateCustomDomain('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects domains with protocol', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');

      expect(validateCustomDomain('https://example.com').valid).toBe(false);
      expect(validateCustomDomain('http://example.com').valid).toBe(false);
    });

    it('rejects domains with path', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('example.com/path').valid).toBe(false);
    });

    it('rejects domains with spaces', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('exam ple.com').valid).toBe(false);
    });

    it('rejects invalid domain format', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('notadomain').valid).toBe(false);
      expect(validateCustomDomain('.com').valid).toBe(false);
      expect(validateCustomDomain('a').valid).toBe(false);
    });

    it('rejects reserved domains', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('nucrm.io').valid).toBe(false);
      expect(validateCustomDomain('nucrm.com').valid).toBe(false);
    });

    it('rejects localhost', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('localhost').valid).toBe(false);
    });

    it('rejects example.com', async () => {
      const { validateCustomDomain } = await import('@/lib/branding');
      expect(validateCustomDomain('example.com').valid).toBe(false);
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

  describe('sanitizeCustomCss', () => {
    it('strips style tag breakout with script injection', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const malicious = "</style><script>alert('xss')</script><style>";
      const result = sanitizeCustomCss(malicious);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('script');
    });

    it('strips expression() CSS attack', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const malicious = "expression(alert('xss'))";
      const result = sanitizeCustomCss(malicious);
      expect(result).not.toMatch(/expression\s*\(/i);
    });

    it('strips @import directives', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const malicious = "@import url('evil.css')";
      const result = sanitizeCustomCss(malicious);
      expect(result).not.toMatch(/@import/i);
    });

    it('strips javascript: URLs in background property', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const malicious = "background: url(javascript:alert('xss'))";
      const result = sanitizeCustomCss(malicious);
      expect(result).not.toMatch(/javascript\s*:/i);
    });

    it('blocks data: URLs in url()', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');
      const result = sanitizeCustomCss("background: url(data:text/html,<script>alert(1)</script>)");
      expect(result).toContain('url(blocked:');
    });

    it('passes through valid CSS unchanged', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const valid = 'color: red; font-size: 14px;';
      const result = sanitizeCustomCss(valid);
      expect(result).toBe(valid);
    });

    it('returns empty string for empty input', async () => {
      const { sanitizeCustomCss } = await import('@/lib/branding');

      const result = sanitizeCustomCss('');
      expect(result).toBe('');
    });
  });

  describe('brandingToCssVars', () => {
    it('converts branding config to CSS custom property map', async () => {
      const { brandingToCssVars } = await import('@/lib/branding');

      const branding = {
        logoUrl: 'https://example.com/logo.png',
        faviconUrl: null,
        primaryColor: '#7c3aed',
        secondaryColor: '#6366f1',
        accentColor: '#f59e0b',
        companyName: 'Acme',
        customDomain: 'crm.acme.com',
        hidePoweredBy: true,
        customCss: null,
        headerLayout: 'centered' as const,
      };

      const vars = brandingToCssVars(branding);
      expect(vars['--brand-primary']).toBe('#7c3aed');
      expect(vars['--brand-secondary']).toBe('#6366f1');
      expect(vars['--brand-accent']).toBe('#f59e0b');
      expect(vars['--brand-logo-url']).toBe('url(https://example.com/logo.png)');
      expect(vars['--brand-header-layout']).toBe('centered');
    });

    it('omits logo-url when no logoUrl', async () => {
      const { brandingToCssVars } = await import('@/lib/branding');

      const branding = {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#000',
        secondaryColor: '#111',
        accentColor: '#222',
        companyName: null,
        customDomain: null,
        hidePoweredBy: false,
        customCss: null,
        headerLayout: 'default' as const,
      };

      const vars = brandingToCssVars(branding);
      expect(vars['--brand-primary']).toBe('#000');
      expect(vars).not.toHaveProperty('--brand-logo-url');
    });
  });

  describe('tenantToBranding', () => {
    it('converts tenant object to BrandingConfig', async () => {
      const { tenantToBranding } = await import('@/lib/branding');

      const tenant = {
        id: 't1',
        name: 'My Corp',
        primaryColor: '#ff0000',
        logoUrl: 'https://example.com/logo.png',
        faviconUrl: null,
        customDomain: 'crm.mycorp.com',
        settings: {},
      };

      const branding = tenantToBranding(tenant);
      expect(branding.companyName).toBe('My Corp');
      expect(branding.primaryColor).toBe('#ff0000');
      expect(branding.logoUrl).toBe('https://example.com/logo.png');
      expect(branding.customDomain).toBe('crm.mycorp.com');
      expect(branding.headerLayout).toBe('default');
      expect(branding.hidePoweredBy).toBe(false);
    });

    it('uses DEFAULT_BRANDING for missing fields', async () => {
      const { tenantToBranding, DEFAULT_BRANDING } = await import('@/lib/branding');

      const tenant = { id: 't1' };
      const branding = tenantToBranding(tenant);
      expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
      expect(branding.companyName).toBeNull();
      expect(branding.logoUrl).toBeNull();
    });

    it('handles primary_color (snake_case) alias', async () => {
      const { tenantToBranding } = await import('@/lib/branding');

      const tenant = { primary_color: '#00ff00', settings: {} };
      const branding = tenantToBranding(tenant);
      expect(branding.primaryColor).toBe('#00ff00');
    });

    it('applies branding overrides from settings JSON', async () => {
      const { tenantToBranding } = await import('@/lib/branding');

      const tenant = {
        name: 'Base Corp',
        primaryColor: '#ff0000',
        settings: {
          branding: {
            primaryColor: '#00ff00',
            hidePoweredBy: true,
            headerLayout: 'minimal' as const,
          },
        },
      };

      const branding = tenantToBranding(tenant);
      expect(branding.primaryColor).toBe('#00ff00');
      expect(branding.hidePoweredBy).toBe(true);
      expect(branding.headerLayout).toBe('minimal');
      expect(branding.companyName).toBe('Base Corp');
    });
  });

  describe('getBrandingForTenant', () => {
    it('returns branding for existing tenant', async () => {
      mockDbSelectResult.length = 0;
      mockDbSelectResult.push({
        logoUrl: 'https://example.com/logo.png',
        faviconUrl: null,
        primaryColor: '#ff6600',
        customDomain: 'crm.example.com',
        name: 'Example Inc',
        settings: { branding: { hidePoweredBy: true } },
      });

      const { getBrandingForTenant } = await import('@/lib/branding');
      const branding = await getBrandingForTenant('tenant-1');

      expect(branding.companyName).toBe('Example Inc');
      expect(branding.primaryColor).toBe('#ff6600');
      expect(branding.logoUrl).toBe('https://example.com/logo.png');
      expect(branding.customDomain).toBe('crm.example.com');
      expect(branding.hidePoweredBy).toBe(true);
    });

    it('returns defaults when tenant not found', async () => {
      mockDbSelectResult.length = 0;

      const { getBrandingForTenant, DEFAULT_BRANDING } = await import('@/lib/branding');
      const branding = await getBrandingForTenant('nonexistent');

      expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
      expect(branding.companyName).toBeNull();
    });

    it('handles null settings gracefully', async () => {
      mockDbSelectResult.length = 0;
      mockDbSelectResult.push({
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        customDomain: null,
        name: null,
        settings: null,
      });

      const { getBrandingForTenant, DEFAULT_BRANDING } = await import('@/lib/branding');
      const branding = await getBrandingForTenant('tenant-null');
      expect(branding.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    });
  });

  describe('getBrandingForDomain', () => {
    it('returns branding for matching domain', async () => {
      mockDbSelectResult.length = 0;
      mockDbSelectResult.push({
        id: 't1',
        logoUrl: 'https://example.com/logo.png',
        faviconUrl: null,
        primaryColor: '#ff6600',
        customDomain: 'crm.example.com',
        name: 'Example Inc',
        settings: {},
      });

      const { getBrandingForDomain } = await import('@/lib/branding');
      const branding = await getBrandingForDomain('crm.example.com');

      expect(branding).not.toBeNull();
      expect(branding!.companyName).toBe('Example Inc');
      expect(branding!.primaryColor).toBe('#ff6600');
    });

    it('returns null for unknown domain', async () => {
      mockDbSelectResult.length = 0;

      const { getBrandingForDomain } = await import('@/lib/branding');
      const branding = await getBrandingForDomain('unknown.com');

      expect(branding).toBeNull();
    });
  });
});
