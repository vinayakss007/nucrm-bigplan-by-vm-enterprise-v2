/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { findMissingRequiredFields } from '@/app/api/forms/submit/route';

const fields = [
  { key: 'first_name', label: 'First Name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'message', label: 'Message', type: 'textarea', required: false },
];

describe('findMissingRequiredFields (#1160)', () => {
  it('reports all required fields as missing when data is empty', () => {
    expect(findMissingRequiredFields(fields, {})).toEqual(['First Name', 'Email']);
  });

  it('treats empty/whitespace strings as missing', () => {
    expect(findMissingRequiredFields(fields, { first_name: '   ', email: '' })).toEqual([
      'First Name',
      'Email',
    ]);
  });

  it('passes when all required fields are present', () => {
    expect(findMissingRequiredFields(fields, { first_name: 'Ada', email: 'a@x.com' })).toEqual([]);
  });

  it('ignores non-required fields', () => {
    // message is not required, so omitting it is fine
    expect(findMissingRequiredFields(fields, { first_name: 'Ada', email: 'a@x.com' })).toEqual([]);
  });

  it('falls back to the key when a field has no label', () => {
    const f = [{ key: 'phone', required: true }];
    expect(findMissingRequiredFields(f, {})).toEqual(['phone']);
  });

  it('returns [] for non-array / malformed field definitions', () => {
    expect(findMissingRequiredFields(null, {})).toEqual([]);
    expect(findMissingRequiredFields(undefined, {})).toEqual([]);
    expect(findMissingRequiredFields({} as unknown, {})).toEqual([]);
  });

  it('accepts non-empty non-string values (e.g. numbers, booleans)', () => {
    const f = [{ key: 'count', label: 'Count', required: true }];
    expect(findMissingRequiredFields(f, { count: 0 })).toEqual([]);
    expect(findMissingRequiredFields(f, { count: false })).toEqual([]);
  });
});
