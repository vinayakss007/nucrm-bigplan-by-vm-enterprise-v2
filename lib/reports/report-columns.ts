/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * The column list each custom report actually returns, in one place.
 *
 * This file used to not exist: the builder page kept its own hardcoded copy of
 * the columns and the API resolved a different set, and the two drifted. A
 * customer could pick `deals.value`, `companies.size` or `tasks.completed` from
 * the dropdown, the API returned no such key, and the column rendered blank —
 * while `filters` named the same phantom columns and the server dropped them.
 * `app/api/tenant/reports/run/route.ts` resolves every name here against the
 * schema, and the unit test renders every one of them, so a name can no longer
 * survive in one list without existing in the other.
 *
 * Pure data with no server imports: the client component renders its pickers
 * from it.
 */
export const REPORT_COLUMNS = {
  contacts: [
    'first_name', 'last_name', 'email', 'phone', 'job_title', 'company_name',
    'city', 'country', 'lead_status', 'lead_source', 'score', 'lifecycle_stage',
    'company_id', 'created_at',
  ],
  companies: [
    'name', 'industry', 'size', 'website', 'phone', 'address', 'city', 'country',
    'annual_revenue', 'created_at',
  ],
  deals: [
    'title', 'amount', 'stage', 'close_date', 'company_name', 'contact_name',
    'contact_id', 'created_at',
  ],
  tasks: [
    'title', 'description', 'priority', 'status', 'due_date', 'completed',
    'completed_at', 'contact_name', 'contact_id', 'assigned_to', 'created_at',
  ],
  leads: [
    'first_name', 'last_name', 'full_name', 'email', 'phone', 'title',
    'company_name', 'lead_status', 'lead_source', 'score', 'value', 'created_at',
  ],
  // Aggregates: one dimension plus the counts, fixed by definition.
  pipeline: ['stage', 'count', 'total_value'],
  revenue: ['stage', 'count', 'revenue'],
};

export type ReportColumnKey = keyof typeof REPORT_COLUMNS;

export const REPORT_TYPE_IDS = Object.keys(REPORT_COLUMNS) as ReportColumnKey[];
