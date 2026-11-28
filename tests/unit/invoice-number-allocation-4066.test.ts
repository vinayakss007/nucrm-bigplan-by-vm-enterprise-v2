import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app/api/cron/recurring-invoice-generator/route.ts'), 'utf8');

describe('recurring invoice number allocation (#4066)', () => {
  it('uses an index-friendly MAX instead of a regex CASE over all invoices', () => {
    expect(src).toContain('SUBSTRING(MAX(${invoices.invoiceNumber}) FROM 5)');
    expect(src).not.toMatch(/CASE WHEN \$\{invoices\.invoiceNumber\} ~/);
  });

  it('keeps the per-tenant lock and retry-on-unique-violation behaviour', () => {
    expect(src).toContain('SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE');
    expect(src).toContain('MAX_NUMBER_RETRIES');
  });
});
