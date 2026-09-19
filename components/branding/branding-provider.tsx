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
import { brandingToCssVars, type TenantBranding } from '@/lib/branding';

interface BrandingProviderProps {
  branding: TenantBranding;
  children: React.ReactNode;
}

export default function BrandingProvider({ branding, children }: BrandingProviderProps) {
  const vars = brandingToCssVars(branding);

  return (
    <div data-brand-root="true" style={{ display: 'contents', ...(vars as any) }}>
      {children}
    </div>
  );
}
