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


/**
 * A single in-app notification as consumed by the tenant header bell panel.
 * The API is normalized to snake_case (via toSnakeCase) before use, so both
 * `read_at`/`is_read` and `title`/`message`/`body` variants are tolerated.
 */
export interface HeaderNotification {
  id: string;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  body?: string | null;
  link?: string | null;
  created_at?: string | null;
  read_at?: string | null;
  is_read?: boolean | null;
}

/** Global-search result rows rendered in the header search dropdown. */
export interface SearchLeadResult {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}

export interface SearchContactResult {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

export interface SearchDealResult {
  id: string;
  title?: string | null;
  value?: number | string | null;
}

export interface SearchCompanyResult {
  id: string;
  name?: string | null;
}

export interface SearchTaskResult {
  id: string;
  title?: string | null;
  priority?: string | null;
}

export interface HeaderSearchResults {
  leads?: SearchLeadResult[];
  contacts?: SearchContactResult[];
  deals?: SearchDealResult[];
  companies?: SearchCompanyResult[];
  tasks?: SearchTaskResult[];
}
