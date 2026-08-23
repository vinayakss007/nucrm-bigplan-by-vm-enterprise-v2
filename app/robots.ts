/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { MetadataRoute } from 'next';

/**
 * Robots policy.
 *
 * The marketing site should be indexed. Everything behind authentication, the
 * API surface, and tokenised per-recipient links (public offers, satisfaction
 * surveys, shared forms) must not be — those URLs are private by obscurity and
 * indexing them would expose customer data.
 */
const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nucrm.abetworks.in').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          // Operator install guide: names infrastructure and shows connection
          // strings. Publicly reachable today, but must not be indexed.
          '/docs',
          '/tenant/',
          '/superadmin/',
          '/portal/',
          '/auth/',
          '/setup',
          '/health',
          '/offline',
          '/p/',
          '/public/',
          '/forms/public/',
          '/lead-capture',
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
