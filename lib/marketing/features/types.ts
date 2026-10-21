/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Marketing site feature content — the Pillar shape used by every pillar module.
 */

export type Pillar = {
  slug: string;
  name: string;
  /** Short label used in nav/cards. */
  short: string;
  icon: string;
  /** Tailwind gradient stops, e.g. 'from-blue-500 to-indigo-500'. */
  accent: string;
  eyebrow: string;
  headline: string;
  sub: string;
  /** One-liner for cards and the features grid. */
  blurb: string;
  highlights: { title: string; desc: string; icon: string }[];
  /** Grouped, exhaustive capability lists for the deep page. */
  capabilities: { heading: string; items: string[] }[];
  outcomes: string[];
  /** Slugs of other pillars worth reading next. */
  related: string[];
};

