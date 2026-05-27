/**
 * Tenant branding helpers.
 *
 * Reads the small set of branding fields already on the `tenants` table
 * (primaryColor, logoUrl, customDomain) and turns them into a normalised
 * shape plus CSS variables that the rest of the app can consume.
 *
 * v1 keeps this deliberately minimal: just primary colour, logo URL,
 * custom domain. Future iterations can add secondaryColor, accentColor,
 * faviconUrl, and a hideBranding flag (the last is plan-gated).
 */

export interface TenantBranding {
  /** Primary brand colour as a CSS-valid string, e.g. "#7c3aed". */
  primaryColor: string;
  /** Optional public URL of the workspace logo. */
  logoUrl: string | null;
  /** Optional custom domain (e.g. crm.acme.com). */
  customDomain: string | null;
}

const DEFAULT_PRIMARY = '#7c3aed';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Validate a hex color and fall back to the default when malformed. */
export function safeColor(value: string | null | undefined): string {
  if (typeof value !== 'string') return DEFAULT_PRIMARY;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : DEFAULT_PRIMARY;
}

/**
 * Normalise an arbitrary tenant-shaped object into the branding subset.
 * Accepts both the snake_case shape returned by /api/tenant/workspace
 * and the camelCase row shape from drizzle queries.
 */
export function tenantToBranding(tenant: {
  primaryColor?: string | null;
  primary_color?: string | null;
  logoUrl?: string | null;
  logo_url?: string | null;
  customDomain?: string | null;
  custom_domain?: string | null;
}): TenantBranding {
  return {
    primaryColor: safeColor(tenant.primaryColor ?? tenant.primary_color),
    logoUrl: tenant.logoUrl ?? tenant.logo_url ?? null,
    customDomain: tenant.customDomain ?? tenant.custom_domain ?? null,
  };
}

/**
 * Produce the CSS variable map that <BrandingProvider> injects into
 * the page so brand-aware styles (Tailwind arbitrary values, inline
 * `style={{ background: 'var(--brand-primary)' }}`) just work.
 *
 * Includes a derived "contrast" variable so buttons can pick text
 * colour without recomputing on the client.
 */
export function brandingToCssVars(branding: TenantBranding): Record<string, string> {
  const primary = branding.primaryColor;
  const contrast = readableTextColor(primary);
  return {
    '--brand-primary': primary,
    '--brand-primary-contrast': contrast,
  };
}

/**
 * Pick black or white based on relative luminance of the supplied hex
 * colour. Used to keep button labels readable regardless of the brand
 * colour the workspace picks. Algorithm: WCAG 2.x luminance.
 */
export function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#111827' : '#ffffff';
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '');
  if (m.length === 3) {
    const r = parseInt(m[0]! + m[0]!, 16);
    const g = parseInt(m[1]! + m[1]!, 16);
    const b = parseInt(m[2]! + m[2]!, 16);
    return [r, g, b];
  }
  if (m.length === 6 || m.length === 8) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}
