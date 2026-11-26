/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3732 — source-pinned contracts for the three engine bugs:
 * company name is the joined company's NAME, not a UUID; the monthly cap is
 * actually compared; and SMS-only campaigns cannot report false success.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/lead-warming/engine.ts'), 'utf8');

describe('#3732 lead-warming engine bugs', () => {
  it('companyName selects the joined company name, never contacts.companyId', () => {
    expect(src).toContain("import { contacts, companies } from '@/drizzle/schema'");
    expect(src.match(/companyName: companies\.name/g)).toHaveLength(2);
    expect(src).not.toContain('companyName: contacts.companyId');
    expect(src.match(/\.leftJoin\(companies, eq\(companies\.id, contacts\.companyId\)\)/g)).toHaveLength(2);
  });

  it('the monthly message cap is enforced in SQL before the contact window', () => {
    expect(src).toMatch(/campaign\.maxMessagesPerContactPerMonth \?\? 4/);
    expect(src).toContain('COALESCE(messages_this_month, 0) >= ${monthlyCap}');
    expect(src).toContain('notInArray(contacts.id, excludedIds)');
  });

  it('SMS-only campaigns are reported as skipped, not silently successful', () => {
    expect(src).toMatch(/const deliverable = channels\.filter\(c => c === 'email' \|\| c === 'whatsapp'\)/);
    expect(src).toContain('SMS delivery not implemented');
    expect(src).toContain('const channel = deliverable[0]!');
  });
});
