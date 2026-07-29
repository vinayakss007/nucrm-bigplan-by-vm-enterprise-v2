import type { MetadataRoute } from 'next';
import { PILLARS } from '@/lib/marketing/features';
import { SOLUTIONS } from '@/lib/marketing/solutions';
import { COMPARISONS } from '@/lib/marketing/compare';
import { STUDIO_PRODUCTS } from '@/lib/marketing/abetworks';
import { getPublishedSections } from '@/lib/marketing/docs';

/**
 * Sitemap for the public marketing site.
 *
 * Only public marketing routes are listed. Application routes (/tenant,
 * /superadmin, /portal), authentication pages and tokenised public links such as
 * offer or survey URLs are deliberately excluded — they are either gated or
 * per-recipient, and indexing them would be wrong.
 *
 * Set NEXT_PUBLIC_SITE_URL to your canonical origin in production.
 */
const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nucrm.abetworks.in').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] = 'monthly',
  ): MetadataRoute.Sitemap[number] => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    entry('/', 1, 'weekly'),
    entry('/features', 0.9, 'weekly'),
    entry('/pricing', 0.9, 'weekly'),
    entry('/solutions', 0.8),
    entry('/compare', 0.8),
    entry('/modules', 0.8),
    entry('/integrations', 0.7),
    entry('/security', 0.7),
    entry('/abetworks', 0.7),
    entry('/contact', 0.6),
    // /docs is deliberately absent. It is an operator install guide (setup
    // prerequisites, connection strings, deployment steps) rather than customer
    // documentation, and it names infrastructure we do not disclose publicly.
    // See the matching Disallow in app/robots.ts.

    ...PILLARS.map((p) => entry(`/features/${p.slug}`, 0.8)),
    ...SOLUTIONS.map((s) => entry(`/solutions/${s.slug}`, 0.7)),
    ...COMPARISONS.map((c) => entry(`/compare/${c.slug}`, 0.7)),
    ...STUDIO_PRODUCTS.map((p) => entry(`/abetworks/${p.slug}`, 0.6)),

    // Documentation
    entry('/docs', 0.7),
    ...getPublishedSections().flatMap((sec) =>
      sec.articles.map((a) => entry(`/docs/${sec.slug}/${a.slug}`, 0.5)),
    ),

    entry('/legal/privacy', 0.3, 'yearly'),
    entry('/legal/terms', 0.3, 'yearly'),
    entry('/legal/dpa', 0.3, 'yearly'),
  ];
}
