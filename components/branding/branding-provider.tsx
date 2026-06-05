/**
 * Server component wrapper that injects tenant branding CSS variables
 * onto the page. Renders a <style> block with --brand-primary and
 * --brand-primary-contrast scoped to a wrapper element, plus the
 * children. Pure server component — no 'use client' — so it can be
 * dropped straight into the tenant layout without a client/server
 * boundary cost.
 */
import { brandingToCssVars, type TenantBranding } from '@/lib/branding';

interface BrandingProviderProps {
  branding: TenantBranding;
  children: React.ReactNode;
}

export default function BrandingProvider({ branding, children }: BrandingProviderProps) {
  const vars = brandingToCssVars(branding);
  // Build "key:value;" pairs without inline JSX.style[] noise so the markup
  // stays small and the colour values are easy to scan in dev tools.
  const styleString = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');

  return (
    <div data-brand-root="true" style={{ display: 'contents' }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `[data-brand-root]{${styleString}}`,
        }}
      />
      {children}
    </div>
  );
}
