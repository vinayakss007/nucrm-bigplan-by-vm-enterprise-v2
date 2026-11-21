/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3763 — both kanban boards must normalize the API's snake_case rows into
 * camelCase Deal rows, and the drag PATCH must send the key the route accepts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeDealRow } from '@/lib/deals/normalize-api-row';

const root = process.cwd();
const client = readFileSync(join(root, 'app/tenant/deals/kanban/kanban-client.tsx'), 'utf8');
const secondary = readFileSync(join(root, 'components/tenant/deals-kanban.tsx'), 'utf8');

describe('#3763 deal row normalization', () => {
  it('maps snake_case API fields to the camelCase Deal shape', () => {
    const row = normalizeDealRow({
      id: 'd1', stage_id: 'stage-1', stage_name: 'Won', close_date: '2026-12-01',
      assigned_to: 'u1', assigned_name: 'Rep', contact_id: 'c1', company_name: 'Acme',
      created_at: '2026-11-01', amount: '100',
    });
    expect(row).toMatchObject({
      id: 'd1', stageId: 'stage-1', stageName: 'Won', closeDate: '2026-12-01',
      assignedTo: 'u1', assignedName: 'Rep', contactId: 'c1', companyName: 'Acme',
      createdAt: '2026-11-01',
    });
  });

  it('does not lose an already-normalized row', () => {
    expect(normalizeDealRow({ id: 'd2', stageId: 's2', stageName: 'Lead' }).stageId).toBe('s2');
  });
});

describe('#3763 both kanban consumers', () => {
  it('the main board normalizes API rows and PATCHes stage_id', () => {
    expect(client).toContain("import { normalizeDealRow } from '@/lib/deals/normalize-api-row'");
    expect(client).toContain('list.map(normalizeDealRow)');
    expect(client).toContain('body: JSON.stringify({ stage_id: newStageId })');
    expect(client).not.toContain('body: JSON.stringify({ stageId: newStageId })');
  });

  it('the secondary board normalizes on refresh instead of toSnakeCase', () => {
    expect(secondary).toContain('normalizeDealRow(d as never)');
    expect(secondary).not.toContain('toSnakeCase');
  });
});
