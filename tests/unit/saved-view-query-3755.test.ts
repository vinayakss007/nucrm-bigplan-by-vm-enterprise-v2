/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3755 — a saved view must restore the search query it was saved with,
 * including clearing the current query when the view had none.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const views = readFileSync(join(root, 'components/tenant/saved-views.tsx'), 'utf8');
const search = readFileSync(join(root, 'components/tenant/advanced-search.tsx'), 'utf8');

describe('#3755 saved view query', () => {
  it('saves the query alongside the filters', () => {
    expect(views).toContain('filters: { ...currentFilters, query: currentQuery },');
  });

  it('applies an absent saved query as empty, not the on-screen text', () => {
    expect(views).toContain("typeof view.filters?.['query'] === 'string' ? view.filters['query'] : ''");
    expect(views).not.toContain(": currentQuery;\n    onApplyView");
  });

  it('always calls onQueryChange, including to clear a query', () => {
    expect(search).toContain("onQueryChange(q ?? '');");
    expect(search).not.toContain('if (q) onQueryChange(q);');
  });
});
