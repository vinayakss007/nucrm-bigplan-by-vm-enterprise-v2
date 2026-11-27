/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3984 — mutating tenant routes that deliberately have no role gate because
 * every write is scoped to the caller's own identity (or is a counter on the
 * caller's own tenant form). Anything mutating shared/tenant-wide state must
 * call requirePerm/can instead and MUST NOT be added here.
 *
 * Keys are paths relative to app/api/tenant, without the trailing /route.ts.
 * tests/unit/ungated-mutations-allowlist-3984.test.ts fails when a route is
 * missing from this set or when a stale entry hides a newly added permission
 * gate.
 */
export const SELF_SCOPED_MUTATIONS: ReadonlySet<string> = new Set([
  '2fa/backup-codes',
  '2fa/disable',
  '2fa/setup',
  '2fa/verify',
  'ai-keys',
  'dashboard/layout',
  'field-sales/checkin',
  'field-sales/checkout',
  'forms/[id]/analytics',
  'notification-prefs',
  'notifications',
  'notifications/matrix',
  'onboarding/complete',
  'user/preferences',
] as const);
