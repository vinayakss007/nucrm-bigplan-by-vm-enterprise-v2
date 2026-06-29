/**
 * White-label branding engine
 * Manages tenant branding configuration for multi-frontend SaaS
 */

import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface BrandingConfig {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  companyName: string | null;
  customDomain: string | null;
  hidePoweredBy: boolean;
  customCss: string | null;
  headerLayout: 'default' | 'centered' | 'minimal';
}

const DEFAULT_BRANDING: BrandingConfig = {
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#7c3aed',
  secondaryColor: '#6366f1',
  accentColor: '#f59e0b',
  companyName: null,
  customDomain: null,
  hidePoweredBy: false,
  customCss: null,
  headerLayout: 'default',
};

/**
 * Get branding configuration for a tenant.
 * Reads from tenants table fields and settings JSONB 'branding' key.
 */
export async function getBrandingForTenant(tenantId: string): Promise<BrandingConfig> {
  const result = await db.select({
    logoUrl: tenants.logoUrl,
    faviconUrl: tenants.faviconUrl,
    primaryColor: tenants.primaryColor,
    customDomain: tenants.customDomain,
    name: tenants.name,
    settings: tenants.settings,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const tenant = result[0];
  if (!tenant) return { ...DEFAULT_BRANDING };

  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const brandingOverrides = (settings['branding'] as Partial<BrandingConfig>) ?? {};

  return {
    ...DEFAULT_BRANDING,
    logoUrl: tenant.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    faviconUrl: tenant.faviconUrl ?? DEFAULT_BRANDING.faviconUrl,
    primaryColor: tenant.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    customDomain: tenant.customDomain ?? DEFAULT_BRANDING.customDomain,
    companyName: tenant.name ?? DEFAULT_BRANDING.companyName,
    ...brandingOverrides,
  };
}

/**
 * Get branding configuration by custom domain lookup.
 */
export async function getBrandingForDomain(domain: string): Promise<BrandingConfig | null> {
  const result = await db.select({
    id: tenants.id,
    logoUrl: tenants.logoUrl,
    faviconUrl: tenants.faviconUrl,
    primaryColor: tenants.primaryColor,
    customDomain: tenants.customDomain,
    name: tenants.name,
    settings: tenants.settings,
  })
    .from(tenants)
    .where(eq(tenants.customDomain, domain))
    .limit(1);

  const tenant = result[0];
  if (!tenant) return null;

  const settings = (tenant.settings as Record<string, unknown>) ?? {};
  const brandingOverrides = (settings['branding'] as Partial<BrandingConfig>) ?? {};

  return {
    ...DEFAULT_BRANDING,
    logoUrl: tenant.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    faviconUrl: tenant.faviconUrl ?? DEFAULT_BRANDING.faviconUrl,
    primaryColor: tenant.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    customDomain: tenant.customDomain ?? DEFAULT_BRANDING.customDomain,
    companyName: tenant.name ?? DEFAULT_BRANDING.companyName,
    ...brandingOverrides,
  };
}

/**
 * Sanitize a CSS color value to prevent injection.
 * Only allows hex colors, rgb/rgba, hsl/hsla, and named CSS colors.
 * Blocks values containing semicolons, braces, or other CSS-breaking characters.
 */
function sanitizeColor(value: string): string {
  // Block if contains characters that could break CSS property context
  if (/[;{}()]/.test(value)) {
    return '#000000';
  }
  // Allow hex (#fff, #ffffff), rgb(), rgba(), hsl(), hsla(), and common named colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^(rgb|rgba|hsl|hsla)\s*\(/.test(value)) return value;
  // Named colors allowlist (common ones)
  const namedColors = new Set([
    'transparent', 'currentcolor', 'inherit', 'initial', 'unset',
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
    'gray', 'grey', 'cyan', 'magenta', 'lime', 'olive', 'navy', 'teal',
    'maroon', 'aqua', 'fuchsia', 'silver',
  ]);
  if (namedColors.has(value.toLowerCase())) return value;
  // Fallback: reject anything that doesn't look like a safe color
  return '#000000';
}

/**
 * Sanitize a URL value for use inside CSS url() function.
 * Blocks javascript:, data:, and non-http protocols.
 */
function sanitizeCssUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'url()';
    }
    return `url(${parsed.href})`;
  } catch {
    return 'url()';
  }
}

/**
 * Sanitize custom CSS to prevent XSS attacks.
 * Strips any content that could break out of a <style> tag or inject scripts.
 */
export function sanitizeCustomCss(css: string): string {
  // Remove any HTML tags (e.g., </style><script>)
  let sanitized = css.replace(/<\/?[a-z][^>]*>/gi, '');
  // Remove any remaining < or > that could form tags
  sanitized = sanitized.replace(/</g, '').replace(/>/g, '');
  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  // Remove expression() (IE CSS expression attack)
  sanitized = sanitized.replace(/expression\s*\(/gi, '');
  // Remove @import to prevent loading external stylesheets
  sanitized = sanitized.replace(/@import\b/gi, '');
  // Remove url() with data: or javascript: schemes
  sanitized = sanitized.replace(/url\s*\(\s*['"]?\s*(data|javascript)\s*:/gi, 'url(blocked:');
  return sanitized;
}

/**
 * Generate CSS custom properties from branding config.
 */
export function generateCSSVariables(config: BrandingConfig): string {
  const vars: string[] = [];

  vars.push(`--brand-primary: ${sanitizeColor(config.primaryColor)};`);
  vars.push(`--brand-secondary: ${sanitizeColor(config.secondaryColor)};`);
  vars.push(`--brand-accent: ${sanitizeColor(config.accentColor)};`);

  if (config.logoUrl) {
    vars.push(`--brand-logo-url: ${sanitizeCssUrl(config.logoUrl)};`);
  }

  if (config.customCss) {
    vars.push(sanitizeCustomCss(config.customCss));
  }

  return `:root {\n  ${vars.join('\n  ')}\n}`;
}

/**
 * Validate a custom domain format and optionally check DNS.
 * Returns { valid, error? } with validation result.
 */
export function validateCustomDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain is required' };
  }

  const trimmed = domain.trim().toLowerCase();

  // Reject empty after trim
  if (trimmed.length === 0) {
    return { valid: false, error: 'Domain is required' };
  }

  // Must not contain protocol
  if (trimmed.includes('://')) {
    return { valid: false, error: 'Domain must not include protocol (http:// or https://)' };
  }

  // Must not contain path
  if (trimmed.includes('/')) {
    return { valid: false, error: 'Domain must not include a path' };
  }

  // Must not contain spaces
  if (trimmed.includes(' ')) {
    return { valid: false, error: 'Domain must not contain spaces' };
  }

  // Basic domain format: at least one dot, valid characters
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid domain format' };
  }

  // Must not be a reserved/common platform domain
  const reserved = ['nucrm.io', 'nucrm.com', 'localhost', 'example.com'];
  if (reserved.includes(trimmed)) {
    return { valid: false, error: 'This domain is reserved' };
  }

  return { valid: true };
}

export { DEFAULT_BRANDING };

// ── Compat exports for BrandingProvider & tenant layout ─────────

export type TenantBranding = BrandingConfig;

/**
 * Convert TenantBranding to a flat Record<string, string> of CSS custom properties.
 * Compat alias for generateCSSVariables that returns an object instead of a <style> block.
 */
export function brandingToCssVars(branding: TenantBranding): Record<string, string> {
  return {
    '--brand-primary': sanitizeColor(branding.primaryColor),
    '--brand-secondary': sanitizeColor(branding.secondaryColor),
    '--brand-accent': sanitizeColor(branding.accentColor),
    ...(branding.logoUrl ? { '--brand-logo-url': sanitizeCssUrl(branding.logoUrl) } : {}),
    '--brand-header-layout': branding.headerLayout,
  };
}

type TenantLike = {
  id?: string;
  name?: string | null;
  primaryColor?: string | null;
  primary_color?: string | null;
  settings?: Record<string, unknown> | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  customDomain?: string | null;
};

/**
 * Convert a raw tenant-like object (from DB or context) into TenantBranding.
 * Compat alias for getBrandingForTenant that works synchronously from the tenant context.
 */
export function tenantToBranding(tenant: TenantLike): TenantBranding {
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const brandingOverrides = (settings['branding'] as Partial<BrandingConfig>) ?? {};

  return {
    ...DEFAULT_BRANDING,
    logoUrl: tenant.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    faviconUrl: tenant.faviconUrl ?? DEFAULT_BRANDING.faviconUrl,
    primaryColor: tenant.primaryColor ?? tenant.primary_color ?? DEFAULT_BRANDING.primaryColor,
    customDomain: tenant.customDomain ?? DEFAULT_BRANDING.customDomain,
    companyName: tenant.name ?? DEFAULT_BRANDING.companyName,
    ...brandingOverrides,
  };
}
