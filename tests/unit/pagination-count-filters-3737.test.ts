/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3737 — a filtered list's pagination total must describe the filtered set.
 * Both routes used to apply status/contactId to the rows but not to the count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const contracts = readFileSync(join(root, 'app/api/tenant/contracts/route.ts'), 'utf8');
const orders = readFileSync(join(root, 'app/api/tenant/orders/route.ts'), 'utf8');

describe('#3737 pagination totals honour list filters', () => {
  it('contracts count reuses the same filters as the row query', () => {
    expect(contracts).toMatch(/\.from\(contracts\)\.where\(and\(\.\.\.filters\)\)/g);
    expect(contracts.match(/\.from\(contracts\)\.where\(and\(\.\.\.filters\)\)/g)).toHaveLength(2);
    // No second hand-built tenant/tombstone predicate for the count.
    expect(contracts).not.toMatch(/count\(\)\).*where\(and\(eq\(contracts\.tenantId/);
  });

  it('orders count reuses the same filters as the row query', () => {
    expect(orders.match(/\.from\(orders\)\.where\(and\(\.\.\.whereConditions\)\)/g)).toHaveLength(2);
    expect(orders).not.toMatch(/count\(\)\).*where\(and\(eq\(orders\.tenantId/);
  });
});
