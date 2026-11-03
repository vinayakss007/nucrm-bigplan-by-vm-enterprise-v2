/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The landing page, as a composition root (#3429).
 *
 * Every section is one component in `components/marketing/home/`, and the copy
 * those sections render is data in `lib/marketing/` (`home.ts`, `tour.ts`,
 * `site.ts`, `pricing.ts`, …). This file used to inline all of it — 737 lines
 * against a #1843 ratchet entry of 778, which is a ceiling that constrains
 * nobody. It is now short enough for its entry to be deleted, so the next
 * growth is caught at 500 lines instead of at whatever the last bookkeeping run
 * measured: #3393 grew it 729 → 778, and #3400 is what that did to the suite.
 */
import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { CtaBand } from '@/components/marketing/ui';
import { HomeHero } from '@/components/marketing/home/hero';
import { HomeModuleMarquee } from '@/components/marketing/home/module-marquee';
import { HomeStack } from '@/components/marketing/home/the-stack';
import { HomeStats } from '@/components/marketing/home/stats';
import { HomeBento } from '@/components/marketing/home/bento';
import { HomeTour } from '@/components/marketing/home/tour';
import { HomeIndustries } from '@/components/marketing/home/industries';
import { HomeIntegrations } from '@/components/marketing/home/integrations';
import { HomeSecurity } from '@/components/marketing/home/security';
import { HomeCompareTeaser } from '@/components/marketing/home/compare-teaser';
import { HomePricing } from '@/components/marketing/home/pricing';
import { HomeFaq } from '@/components/marketing/home/faq';

export const metadata: Metadata = {
  // The layout template would append "| NuCRM by abetworks"; the landing page
  // owns its full title instead.
  title: {
    absolute: `${BRAND.product} by ${BRAND.maker} — ${BRAND.promise}`,
  },
  description: BRAND.description,
  alternates: { canonical: '/' },
};

export default function LandingPage() {
  return (
    <div className="mk-home mk-noise">
      <HomeHero />
      <HomeModuleMarquee />
      <HomeStack />
      <HomeStats />
      <HomeBento />
      <HomeTour />
      <HomeIndustries />
      <HomeIntegrations />
      <HomeSecurity />
      <HomeCompareTeaser />
      <HomePricing />
      <HomeFaq />
      <CtaBand />
    </div>
  );
}
