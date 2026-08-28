/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Least-privilege default-role selection for auto-provisioned users (SSO + SCIM).
 *
 * Shared so SSO login (app/api/auth/sso/callback) and SCIM user creation
 * (app/api/scim/v2/Users) pick the SAME safe default. Previously each had its
 * own fallback that could land on the tenant's `admin` role — a silent
 * privilege escalation for IdP-managed users.
 */

/** A tenant role, as needed for least-privilege default selection. */
export interface SelectableRole {
  id: string;
  slug: string;
  sortOrder: number | null;
}

/**
 * Choose the least-privilege default role for an auto-provisioned user.
 *
 * SECURITY: never returns an `admin`/`super_admin` role. Prefers the known
 * low-privilege slugs; otherwise the lowest-privilege non-admin role (highest
 * sortOrder in this schema, tie-broken by slug for determinism). Returns
 * `undefined` when only admin-level roles exist, so callers decline to
 * auto-provision rather than silently granting admin.
 */
export function selectLeastPrivilegeRole<T extends SelectableRole>(tenantRoles: T[]): T | undefined {
  const PREFERRED = ['sales_rep', 'member', 'viewer', 'user', 'agent'];
  const nonAdmin = tenantRoles.filter((r) => r.slug !== 'admin' && r.slug !== 'super_admin');
  const preferred = PREFERRED.map((slug) => nonAdmin.find((r) => r.slug === slug)).find(Boolean);
  if (preferred) return preferred;
  return [...nonAdmin].sort(
    (a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0) || a.slug.localeCompare(b.slug),
  )[0];
}
