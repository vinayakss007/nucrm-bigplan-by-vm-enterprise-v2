/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Minimal shape of the tenant/workspace object consumed by the tenant layout
 * shell, sidebar, and header. Only the fields actually read are declared;
 * everything else is allowed via the index signature so callers can pass the
 * full DB row without a cast.
 */
export interface TenantInfo {
  name?: string | null;
  primary_color?: string | null;
  [key: string]: unknown;
}

/**
 * Minimal shape of the current user's profile consumed by the tenant layout.
 */
export interface ProfileInfo {
  full_name?: string | null;
  email?: string | null;
  is_super_admin?: boolean | null;
  metadata?: {
    prefs?: {
      hidden_nav_items?: string[];
    } | null;
  } | null;
  [key: string]: unknown;
}
