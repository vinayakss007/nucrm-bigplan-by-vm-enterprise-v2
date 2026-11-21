/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the status rule for `product_templates`, owned by the entity module
 * and consumed by `lib/state/transitions.ts`. A second copy in a route is how
 * the same entity ends up with two different state machines.
 *
 * `active` and `draft` are live templates that can be archived. An already
 * archived template has no legal archive transition, so a repeated DELETE
 * claims nothing instead of restamping `deleted_at`.
 */
export function allowedTemplateFromStatus(to: string): readonly string[] {
  return to === 'archived' ? ['active', 'draft'] : [];
}
