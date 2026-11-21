/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3750 — the four contact-picker pages must read the real API envelope and
 * normalize its snake_case rows, not a `{ contacts: [...] }` shape that was
 * never sent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contactOptionsFromEnvelope } from '@/lib/contacts/list-options';

const root = process.cwd();

describe('#3750 contact picker response shape', () => {
  it('normalizes the real contacts list envelope', () => {
    const options = contactOptionsFromEnvelope({
      data: [
        { id: 'ct1', first_name: 'Kestrel', last_name: 'Vane', email: 'kestrel@example.test' },
        { id: 'ct2', first_name: 'Ada', last_name: 'Lovelace', email: null },
      ],
    });
    expect(options).toEqual([
      { id: 'ct1', firstName: 'Kestrel', lastName: 'Vane', email: 'kestrel@example.test' },
      { id: 'ct2', firstName: 'Ada', lastName: 'Lovelace', email: null },
    ]);
  });

  it('a missing or empty data array yields no options, never a crash', () => {
    expect(contactOptionsFromEnvelope(undefined)).toEqual([]);
    expect(contactOptionsFromEnvelope({})).toEqual([]);
    expect(contactOptionsFromEnvelope({ data: [] })).toEqual([]);
  });

  it('all four consumer pages read the envelope through the normalizer', () => {
    for (const page of ['invoices', 'contracts', 'quotes', 'orders']) {
      const src = readFileSync(join(root, `app/tenant/${page}/page.tsx`), 'utf8');
      expect(src, page).toContain("import { contactOptionsFromEnvelope } from '@/lib/contacts/list-options'");
      expect(src, page).toContain('contactOptionsFromEnvelope(contactsData)');
      expect(src, page).not.toContain('contactsData?.contacts');
    }
  });
});
