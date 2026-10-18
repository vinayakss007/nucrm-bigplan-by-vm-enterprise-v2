/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { stripRowForRead } from '@/lib/rbac/enforce';

// #2617 — deals detail GET copies `row.stageId` into a legacy `stage` key
// (app/api/tenant/deals/[id]/route.ts) and POST response copies
// `deal.createdBy` into `user_id` (app/api/tenant/deals/route.ts). Before
// this fix, `READ_ALIASES.deals` only knew about `amount -> ['value']`, so
// restricting `stage_id` / `created_by` still leaked the value under the
// alias. Same class of bug as the #2521 amount/value leak, this time for
// two more columns.
describe('stripRowForRead — deals read aliases (#2617)', () => {
  it('restricting stage_id clears both stage_id AND stage', () => {
    const map = new Map([['stage_id', 'none' as const]]);
    const row = {
      id: 'd1', title: 'X', stage_id: 'S-uuid', stage: 'S-uuid',
    };
    expect(stripRowForRead('deals', map, row)).toEqual({
      id: 'd1', title: 'X',
    });
  });

  it('restricting created_by clears both created_by AND user_id', () => {
    const map = new Map([['created_by', 'none' as const]]);
    const row = {
      id: 'd1', created_by: 'u-1', user_id: 'u-1', title: 'X',
    };
    expect(stripRowForRead('deals', map, row)).toEqual({
      id: 'd1', title: 'X',
    });
  });

  it('camelCase row spelling createdBy also matches created_by restriction', () => {
    // Field config rows can be authored with either spelling; the normalizer
    // converts created_by -> createdBy when the DB returns the camel form.
    const map = new Map([['created_by', 'none' as const]]);
    const row = { id: 'd1', createdBy: 'u-1', user_id: 'u-1' };
    expect(stripRowForRead('deals', map, row)).toEqual({ id: 'd1' });
  });

  it('amount + value alias coverage unchanged (regression guard)', () => {
    const map = new Map([['amount', 'none' as const]]);
    expect(stripRowForRead('deals', map, { id: 'd1', amount: '500', value: '500' })).toEqual({ id: 'd1' });
  });

  it('unrestricted stage_id leaves both stage_id and stage intact (default-open)', () => {
    const map = new Map();
    const row = { id: 'd1', stage_id: 'S', stage: 'S' };
    expect(stripRowForRead('deals', map, row)).toEqual(row);
  });
});
