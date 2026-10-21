/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Feature content for the marketing site.
 *
 * Sourced from what actually ships: the tenant screens under app/tenant/**,
 * the module manifests in lib/modules/registry.ts and the Features section of
 * README.md. No internal technology is named anywhere in these files.
 *
 * #422: this file was 661 lines of content data. It now lives in the
 * same-named directory (`lib/marketing/features/`):
 *
 *   - `types.ts`            — the Pillar shape
 *   - `pillars/<slug>.ts`   — one module per marketing pillar
 *   - `pillars.ts`          — PILLARS order + getPillar
 *   - `catalog.ts`          — FEATURE_CATALOG for /features
 *
 * This module is a barrel so `app/(marketing)/*` and `app/sitemap.ts` keep
 * importing from `@/lib/marketing/features` unchanged — file-wins-over-
 * directory resolution, the same precedent as `lib/api/schemas.ts` +
 * `lib/api/schemas/`.
 */
export type { Pillar } from './features/types';
export { PILLARS, getPillar } from './features/pillars';
export { FEATURE_CATALOG } from './features/catalog';
