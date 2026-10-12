/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { pgView, uuid, text, decimal, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// #2263: the deployed view also carries WITH (security_invoker = on), which
// drizzle-orm 0.45 cannot express — it lives only in migration 0115. Do not
// "repair" it with drizzle-kit push; the nightly verify-tenant-isolation survey
// (#2306) guards the property against exactly that.
export const dealsByWinProbability = pgView('deals_by_win_probability', {
  id: uuid('id'),
  tenantId: uuid('tenant_id'),
  title: text('title'),
  amount: decimal('amount'),
  closeDate: timestamp('close_date'),
  stageId: uuid('stage_id'),
  stageName: text('stage_name'),
  stageOrder: integer('stage_order'),
  pipelineId: uuid('pipeline_id'),
  assignedTo: uuid('assigned_to'),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
  probability: decimal('probability'),
}).as(sql`
  SELECT
    d.id,
    d.tenant_id,
    d.title,
    d.amount,
    d.close_date,
    d.stage_id,
    ds.name AS stage_name,
    ds."order" AS stage_order,
    d.pipeline_id,
    d.assigned_to,
    d.contact_id,
    d.company_id,
    d.created_at,
    d.updated_at,
    GREATEST(0.05, LEAST(0.95, ds."order"::numeric / NULLIF(pm.max_order, 0)::numeric)) AS probability
  FROM deals d
  JOIN deal_stages ds ON d.stage_id = ds.id
  CROSS JOIN LATERAL (
    SELECT MAX(ds2."order") AS max_order
    FROM deal_stages ds2
    WHERE ds2.pipeline_id = ds.pipeline_id
  ) pm
  WHERE d.deleted_at IS NULL
`);

export type DealsByWinProbability = typeof dealsByWinProbability.$inferSelect;
