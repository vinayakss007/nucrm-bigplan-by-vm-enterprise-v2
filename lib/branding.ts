/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
 * #1062/#1282: sanitize an individual CSS *value* (e.g. a color or a url())
 * that is interpolated into a <style> block or a CSS custom property.
 *
 * Tenant branding values (primaryColor, etc.) were injected verbatim into
 * `dangerouslySetInnerHTML`, so a value like `red}</style><script>...` or one
 * containing `expression()` / `javascript:` could break out of the CSS
 * context. This strips the characters that allow such breakouts while leaving
 * legitimate colors, gradients and http(s) url() values intact.
 */
export function sanitizeCssValue(value: string): string {
  if (typeof value !== 'string') return '';
  let v = value
    // No tag/brace/semicolon/at breakout characters in a value.
    .replace(/[<>{}\\;]/g, '')
    // Neutralise dangerous CSS constructs.
    .replace(/javascript\s*:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/@import\b/gi, '');
  // url() is only allowed with an http/https target.
  v = v.replace(/url\s*\(\s*['"]?\s*([^'")\s]+)\s*['"]?\s*\)/gi, (match, url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? match : 'url()';
    } catch {
      return /^[a-zA-Z]+:/.test(url) ? 'url()' : match;
    }
  });
  return v.trim();
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
  // Remove javascript: URLs (anywhere, not just at start)
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  // Remove expression() (IE CSS expression attack)
  sanitized = sanitized.replace(/expression\s*\(/gi, '');
  // Remove @import anywhere in the CSS (not just start of string)
  // Matches @import with any leading whitespace, quotes, or url() wrapper
  sanitized = sanitized.replace(/(?:^|[\s;])@import\b/gi, '$1');
  // Remove @import that appears after other CSS (e.g., in a rule block)
  sanitized = sanitized.replace(/@import\b/gi, '/* blocked @import */');
  // Block url() with any non-http/https scheme (data:, javascript:, file:, ftp:, etc.)
  // Only allow http/https URLs in url()
  sanitized = sanitized.replace(/url\s*\(\s*['"]?\s*([^'")\s]+)\s*['"]?\s*\)/gi, (match, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return match; // Allow http/https
      }
      return 'url(blocked)';
    } catch {
      // Not a valid URL - could be a relative path or malformed
      // Block anything that looks like a scheme (e.g., data:, file:)
      if (/^[a-zA-Z]+:/.test(url)) {
        return 'url(blocked)';
      }
      return match; // Allow relative paths
    }
  });
  return sanitized;
}

/**
 * Generate CSS custom properties from branding config.
 */
export function generateCSSVariables(config: BrandingConfig): string {
  const vars: string[] = [];

  // #1062: colors are tenant-controlled and injected into a <style> block —
  // sanitize each value so it cannot break out of the CSS context.
  vars.push(`--brand-primary: ${sanitizeCssValue(config.primaryColor)};`);
  vars.push(`--brand-secondary: ${sanitizeCssValue(config.secondaryColor)};`);
  vars.push(`--brand-accent: ${sanitizeCssValue(config.accentColor)};`);

  if (config.logoUrl) {
    // Only allow http/https URLs to prevent CSS injection via url()
    try {
      const parsed = new URL(config.logoUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        vars.push(`--brand-logo-url: url(${parsed.toString()});`);
      }
    } catch {
      // Invalid URL — skip silently
    }
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
  // #1062: these values flow into a <style dangerouslySetInnerHTML> in
  // BrandingProvider, so every value must be sanitized. The logo URL is
  // validated for an http/https scheme before being wrapped in url().
  const safeLogo = (() => {
    if (!branding.logoUrl) return undefined;
    try {
      const parsed = new URL(branding.logoUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `url(${parsed.toString()})`;
      }
    } catch { /* invalid URL — drop it */ }
    return undefined;
  })();

  return {
    '--brand-primary': sanitizeCssValue(branding.primaryColor),
    '--brand-secondary': sanitizeCssValue(branding.secondaryColor),
    '--brand-accent': sanitizeCssValue(branding.accentColor),
    ...(safeLogo ? { '--brand-logo-url': safeLogo } : {}),
    '--brand-header-layout': sanitizeCssValue(branding.headerLayout),
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
