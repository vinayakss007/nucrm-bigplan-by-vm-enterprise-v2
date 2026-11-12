/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { CookieConsent } from '@/components/marketing/cookie-consent';
import { BRAND } from '@/lib/marketing/site';
import './marketing.css';

/**
 * Public marketing shell.
 *
 * This is a route group, so it adds the header and footer without changing any
 * URL. Everything under it is public: authentication in this application is
 * enforced inside the /tenant, /superadmin and /portal layouts rather than by a
 * global middleware, so no route here needs an exemption.
 *
 * The wrapper hard-sets a dark surface because the marketing site is a fixed
 * composition — it must not shift when a signed-in visitor has the light app
 * theme selected.
 */
export const metadata: Metadata = {
  title: {
    default: `${BRAND.product} — ${BRAND.promise}`,
    template: `%s | ${BRAND.product} by ${BRAND.maker}`,
  },
  description: BRAND.description,
  applicationName: BRAND.product,
  keywords: [
    'CRM',
    'sales CRM',
    'revenue platform',
    'pipeline management',
    'sales automation',
    'AI CRM',
    'helpdesk',
    'invoicing',
    'multi-workspace CRM',
    'NuCRM',
    'abetworks',
  ],
  authors: [{ name: BRAND.maker }],
  creator: BRAND.maker,
  publisher: BRAND.maker,
  openGraph: {
    type: 'website',
    siteName: `${BRAND.product} by ${BRAND.maker}`,
    title: `${BRAND.product} — ${BRAND.promise}`,
    description: BRAND.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.product} — ${BRAND.promise}`,
    description: BRAND.description,
  },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-root relative min-h-screen overflow-x-hidden">
      {/* Painted behind everything so overscroll and short pages keep the
          graphite canvas instead of falling through to plain black. */}
      <div className="fixed inset-0 -z-50 bg-[#171511]" aria-hidden />
      <SiteHeader />
      {/* `main-content` is the id the root layout's SkipLink targets (#1842);
          this landmark used to answer to `main`, which nothing links to, so the
          skip link was inert across the whole marketing site. */}
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <SiteFooter />
      <CookieConsent />
    </div>
  );
}
