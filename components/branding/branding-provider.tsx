/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Server component wrapper that injects tenant branding CSS variables
 * onto the page. Renders a <style> block with --brand-primary and
 * --brand-primary-contrast scoped to a wrapper element, plus the
 * children. Pure server component — no 'use client' — so it can be
 * dropped straight into the tenant layout without a client/server
 * boundary cost.
 */
import { headers } from 'next/headers';
import { brandingToCssVars, type TenantBranding } from '@/lib/branding';

interface BrandingProviderProps {
  branding: TenantBranding;
  children: React.ReactNode;
}

export default async function BrandingProvider({ branding, children }: BrandingProviderProps) {
  const vars = brandingToCssVars(branding);
  // Build "key:value;" pairs without inline JSX.style[] noise so the markup
  // stays small and the colour values are easy to scan in dev tools.
  const styleString = Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');

  // Per-request CSP nonce set by proxy.ts (#1070). REQUIRED on this inline
  // <style>: style-src is now nonce-based (no 'unsafe-inline' for elements), so
  // an un-nonced <style> would be blocked by the browser.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <div data-brand-root="true" style={{ display: 'contents' }}>
      <style
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: `[data-brand-root]{${styleString}}`,
        }}
      />
      {children}
    </div>
  );
}
