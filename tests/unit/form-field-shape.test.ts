/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import {
  getFieldIdentity,
  isFieldRequired,
  normalizeFormFields,
  findMissingRequiredFields,
} from '@/lib/forms/field-shape';

// #2287 — forms created via POST /api/tenant/forms store fields keyed with
// `id`, legacy/seeded forms store them with `key`. The required-field check
// must honor BOTH shapes with a single normalization helper.

describe('getFieldIdentity (#2287)', () => {
  it('prefers key over id (builder rows carry an unrelated numeric id)', () => {
    expect(getFieldIdentity({ id: '1', key: 'first_name' })).toBe('first_name');
  });

  it('falls back to id for API-created fields', () => {
    expect(getFieldIdentity({ id: 'email', label: 'Email' })).toBe('email');
  });

  it('falls back to name when neither key nor id is usable', () => {
    expect(getFieldIdentity({ name: 'phone' })).toBe('phone');
  });

  it('ignores empty/whitespace/non-string identifiers', () => {
    expect(getFieldIdentity({ id: '  ', key: '' })).toBeNull();
    expect(getFieldIdentity({ id: 42 })).toBeNull();
    expect(getFieldIdentity(null)).toBeNull();
    expect(getFieldIdentity('nope')).toBeNull();
  });
});

describe('isFieldRequired (#2287)', () => {
  it('is strict true only', () => {
    expect(isFieldRequired({ required: true })).toBe(true);
    expect(isFieldRequired({ required: 'true' })).toBe(false);
    expect(isFieldRequired({ required: 1 })).toBe(false);
    expect(isFieldRequired({})).toBe(false);
  });
});

describe('normalizeFormFields (#2287)', () => {
  it('normalizes both stored shapes and drops identity-less entries', () => {
    const out = normalizeFormFields([
      { key: 'full_name', label: 'Full Name', required: true },
      { id: 'email', label: 'Email', required: true },
      { label: 'orphan, no identity' },
    ]);
    expect(out).toEqual([
      { identity: 'full_name', label: 'Full Name', required: true },
      { identity: 'email', label: 'Email', required: true },
    ]);
  });

  it('falls back to the identity when the label is missing/blank', () => {
    expect(normalizeFormFields([{ id: 'phone', required: true }])[0].label).toBe('phone');
    expect(normalizeFormFields([{ id: 'phone', label: '  ', required: true }])[0].label).toBe('phone');
  });

  it('returns [] for non-array inputs', () => {
    expect(normalizeFormFields(null)).toEqual([]);
    expect(normalizeFormFields({})).toEqual([]);
    expect(normalizeFormFields(undefined)).toEqual([]);
  });
});

describe('findMissingRequiredFields — both shapes (#2287)', () => {
  const apiShape = [
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'notes', type: 'textarea', label: 'Notes', required: false },
  ];
  const legacyShape = [
    { key: 'full_name', label: 'Full Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
  ];

  it('enforces required on API-created (id-shaped) fields', () => {
    expect(findMissingRequiredFields(apiShape, {})).toEqual(['Email']);
  });

  it('still enforces required on legacy (key-shaped) fields', () => {
    expect(findMissingRequiredFields(legacyShape, {})).toEqual(['Full Name', 'Email']);
  });

  it('passes when the id-shaped required field is provided', () => {
    expect(findMissingRequiredFields(apiShape, { email: 'a@b.com' })).toEqual([]);
  });

  it('never blocks a missing NON-required field (either shape)', () => {
    expect(findMissingRequiredFields(apiShape, { email: 'a@b.com' })).toEqual([]);
    expect(findMissingRequiredFields(legacyShape, { full_name: 'Ada', email: 'a@b.com' })).toEqual([]);
  });

  it('treats whitespace-only values as missing for id-shaped fields', () => {
    expect(findMissingRequiredFields(apiShape, { email: '   ' })).toEqual(['Email']);
  });

  it('key wins when both identifiers are present', () => {
    const both = [{ id: '1', key: 'email', label: 'Email', required: true }];
    expect(findMissingRequiredFields(both, { email: 'a@b.com' })).toEqual([]);
    expect(findMissingRequiredFields(both, {})).toEqual(['Email']);
  });
});
