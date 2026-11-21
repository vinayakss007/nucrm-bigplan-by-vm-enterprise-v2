/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3747 — "Move Deal" resolves stages by ID. The mobile picker used to pass
 * a lowercased stage NAME, which could never match and always toasted
 * "Unknown stage".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/tenant/deals-kanban.tsx'), 'utf8');

describe('#3747 kanban mobile stage id', () => {
  it('resolves stages strictly by id in updateDealStage', () => {
    expect(src).toContain('const newStage = stages.find(s => s.id === newStageId)');
  });

  it('both the desktop and mobile paths pass a stage id', () => {
    expect(src).toContain('await updateDealStage(draggingId, stageId)');
    expect(src).toContain('await updateDealStage(showMobileStagePicker.dealId, stage.id)');
    expect(src).not.toContain('stage.name.toLowerCase()');
  });
});
