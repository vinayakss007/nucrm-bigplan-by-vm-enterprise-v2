/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Serializable prop contracts for the deals page tree.
 *
 * The server component queries Drizzle (which yields `Date`, decimal strings,
 * etc.) and normalizes rows into these plain, JSON-serializable shapes before
 * handing them to the client components. Keeping the contract here lets the
 * page, `DealsPageClient`, and the leaf tables/kanban share one source of
 * truth instead of casting to `any` at the boundary (#1341).
 */

export interface DealRow {
  id: string;
  title: string;
  amount: number;
  stageId: string;
  stage_name: string | null;
  close_date: string | null;
  contact_id: string | null;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface DealStageOption {
  id: string;
  name: string;
  order: number;
  pipelineId: string;
}

export interface DealContactOption {
  id: string;
  first_name: string;
  last_name: string;
}

export interface DealCompanyOption {
  id: string;
  name: string;
}

export interface DealTeamMemberOption {
  user_id: string;
  full_name: string;
}

export interface DealPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewAll: boolean;
  canViewValue: boolean;
}
