/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * CRM request-validation schemas — reduced to the ONE source of truth.
 *
 * #1883: this file previously duplicated ~28 CRM schemas that also live inline
 * in `lib/api/schemas.ts` (the live monolith every route imports). The two
 * copies had drifted (9 schemas differed), creating a second, stale,
 * authoritative-looking source of truth and a latent correctness bug: any
 * future switch of imports to this submodule would silently change validation.
 *
 * The duplicated schemas here were DEAD — nothing imported them from
 * `@/lib/api/schemas/crm`. They have been removed so the monolith is the single
 * source of truth. The only CRM schemas kept here are the two the monolith
 * actually re-exports (tenant hierarchy), which are not defined in the monolith.
 *
 * A CI guard (`scripts/check-schema-drift.mjs`, `npm run guard:schema-drift`)
 * now fails the build if any schema is defined in BOTH this directory and the
 * monolith with a different body, so this drift cannot silently reappear.
 */
import { z } from 'zod';

// ── Tenant hierarchy schemas (re-exported by lib/api/schemas.ts) ──
export const createHierarchySchema = z.object({
  childTenantId: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  relationship: z.enum(['parent', 'division', 'franchise', 'branch']),
  relationship_type: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).optional().default([]),
});

export const updateHierarchySchema = createHierarchySchema.partial().extend({
  id: z.string().uuid(),
});
