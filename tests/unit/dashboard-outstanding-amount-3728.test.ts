/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3728 — "outstanding" is a money figure, not an invoice count.
 * The route must SUM balance_due (not COUNT rows), and the widget must render
 * that number as currency, matching the invoices page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd());
const routeSrc = readFileSync(join(root, 'app/api/tenant/dashboard/widgets/invoices/route.ts'), 'utf8');
const widgetSrc = readFileSync(join(root, 'components/tenant/dashboard/widgets/invoices-widget.tsx'), 'utf8');

describe('#3728 dashboard outstanding amount', () => {
  it('the widget route sums balance_due rather than counting invoices', () => {
    expect(routeSrc).toMatch(/COALESCE\(SUM\(balance_due\), 0\)/);
    expect(routeSrc).not.toMatch(/COUNT\(\*\)\s+::int[^\n]*status IN \('sent', 'overdue'\)/);
    expect(routeSrc).toContain("status IN ('sent', 'overdue')");
  });

  it('the widget formats the outstanding figure as currency', () => {
    expect(widgetSrc).toContain("import { formatCurrency } from '@/lib/utils'");
    expect(widgetSrc).toMatch(/formatCurrency\(Number\(d\.totalOutstanding \?\? 0\)\)/);
  });

  it('the currency helper renders the same shape as the invoices page', async () => {
    const { formatCurrency } = await import('@/lib/utils');
    expect(formatCurrency(12450)).toContain('12,450');
    expect(formatCurrency(0)).toContain('0');
  });
});
