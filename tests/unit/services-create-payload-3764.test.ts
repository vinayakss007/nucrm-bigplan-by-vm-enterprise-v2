/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/** #3764 — POST must send the snake_case keys the create schema accepts. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServiceSchema } from '@/lib/api/schemas/billing';

const root = process.cwd();
const page = readFileSync(join(root, 'app/tenant/services/page.tsx'), 'utf8');

describe('#3764 service create payload', () => {
  it('the page sends the schema keys alongside the form state', () => {
    expect(page).toContain('hourly_rate: form.hourlyRate');
    expect(page).toContain('monthly_rate: form.monthlyPrice');
    expect(page).toContain('yearly_rate: form.yearlyPrice');
  });

  it('the real schema keeps those keys so rates are not stripped', () => {
    const parsed = createServiceSchema.parse({
      name: 'Consulting',
      hourly_rate: 120,
      monthly_rate: 4000,
      yearly_rate: 40000,
    });
    expect(parsed).toMatchObject({ hourly_rate: 120, monthly_rate: 4000, yearly_rate: 40000 });
  });
});
