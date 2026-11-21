/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3763 — the deals API returns snake_case columns (`stage_id`, `stage_name`,
 * `close_date`, …) while both kanban boards define their Deal rows in
 * camelCase. Loading the raw rows left every `stageId` undefined, so every
 * stage column filtered to zero cards; `toSnakeCase` on refresh made it worse.
 *
 * One normalizer keeps both consumers honest. It also accepts an already
 * camelCase row (tests, optimistic local state) without losing data.
 */
export interface DealApiRow {
  id: string;
  [key: string]: unknown;
}

export interface DealLike {
  id: string;
  stageId: string | null;
  stageName?: string;
  closeDate: string | null;
  assignedTo: string | null;
  assignedName?: string;
  contactId: string | null;
  contactName?: string;
  companyName?: string;
  probability: number;
  createdAt: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function normalizeDealRow(row: DealApiRow): DealLike {
  return {
    ...row,
    id: row['id'] as string,
    stageId: str(row['stage_id']) ?? str(row['stageId']),
    stageName: str(row['stage_name']) ?? str(row['stage']) ?? str(row['stageName']),
    closeDate: str(row['close_date']) ?? str(row['closeDate']),
    assignedTo: str(row['assigned_to']) ?? str(row['assignedTo']),
    assignedName: str(row['assigned_name']) ?? str(row['assignedName']),
    contactId: str(row['contact_id']) ?? str(row['contactId']),
    contactName: str(row['contact_name']) ?? str(row['contactName']),
    companyName: str(row['company_name']) ?? str(row['companyName']),
    probability: typeof row['probability'] === 'number' ? row['probability'] : 0,
    createdAt: str(row['created_at']) ?? str(row['createdAt']) ?? '',
  } as DealLike;
}
