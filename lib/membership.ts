/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — tenant_members status vocabulary and transition registry.
 *
 * `tenant_members.status` is a text column whose only DB rule is a value CHECK.
 * SCIM provisioning and deprovisioning each re-encoded "active ↔ inactive" in
 * their own WHERE; this module is the one list both halves read. The SQL claim
 * (via transitionStatus) and any request-side vet share `allowedMemberFromStatus`.
 *
 * Self-transitions are legal: a repeated SCIM provision of an already-active
 * member is a no-op, not a 409, and the from-state claim simply matches no row.
 */
export const TENANT_MEMBER_STATUSES = ['active', 'inactive'] as const;
export type TenantMemberStatus = (typeof TENANT_MEMBER_STATUSES)[number];

export const TENANT_MEMBER_TRANSITIONS: Readonly<
  Record<TenantMemberStatus, readonly TenantMemberStatus[]>
> = {
  active: ['active', 'inactive'],
  inactive: ['active', 'inactive'],
};

/** The from-states a guarded write may claim `to` from. Fail closed on garbage. */
export function allowedMemberFromStatus(to: string): readonly TenantMemberStatus[] {
  if (!(TENANT_MEMBER_STATUSES as readonly string[]).includes(to)) return [];
  return TENANT_MEMBER_STATUSES.filter((from) =>
    TENANT_MEMBER_TRANSITIONS[from].includes(to as TenantMemberStatus),
  );
}

export function canTransitionMember(from: string, to: string): boolean {
  return allowedMemberFromStatus(to).includes(from as TenantMemberStatus);
}
