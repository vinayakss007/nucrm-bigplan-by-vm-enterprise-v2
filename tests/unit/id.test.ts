import { describe, it, expect } from 'vitest';
import {
  uuidToBase62,
  base62ToUuid,
  generateOrgCode,
  generateStructuredId,
  parseStructuredId,
  isStructuredId,
  ENTITY_CODES,
} from '../../lib/id';

// ─── Base62 ↔ UUID conversion ───────────────────────────────

describe('uuidToBase62 / base62ToUuid', () => {
  const knownUuid = '550e8400-e29b-41d4-a716-446655440000';
  const knownBase62 = '2aUyqjCzEIiEcYMKj7TZtw';

  it('converts UUID to base62 (22 chars)', () => {
    const result = uuidToBase62(knownUuid);
    expect(result).toBe(knownBase62);
    expect(result).toHaveLength(22);
  });

  it('converts base62 back to UUID', () => {
    const result = base62ToUuid(knownBase62);
    expect(result).toBe(knownUuid);
  });

  it('round-trips UUID → base62 → UUID losslessly', () => {
    const uuids = [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '123e4567-e89b-12d3-a456-426614174000',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ];

    for (const uuid of uuids) {
      const b62 = uuidToBase62(uuid);
      const back = base62ToUuid(b62);
      expect(back).toBe(uuid);
    }
  });

  it('base62 string contains only valid characters', () => {
    const result = uuidToBase62(knownUuid);
    expect(result).toMatch(/^[0-9A-Za-z]{22}$/);
  });

  it('throws on invalid UUID', () => {
    expect(() => uuidToBase62('not-a-uuid')).toThrow();
    expect(() => uuidToBase62('550e8400-e29b-41d4-a716')).toThrow();
  });

  it('throws on invalid base62', () => {
    expect(() => base62ToUuid('')).toThrow();
    expect(() => base62ToUuid('short')).toThrow();
    expect(() => base62ToUuid('!@#$%^&*()_+={}[]|')).toThrow();
  });
});

// ─── Org code generation ────────────────────────────────────

describe('generateOrgCode', () => {
  it('takes first 4 chars of slug, uppercased', () => {
    expect(generateOrgCode('acme')).toBe('ACME');
    expect(generateOrgCode('bigcorp')).toBe('BIGC');
  });

  it('pads short slugs with digits', () => {
    const code = generateOrgCode('ab');
    expect(code).toMatch(/^AB\d{2}$/);
  });

  it('avoids collisions by appending sequential numbers', () => {
    const existing = new Set(['ACME', 'ACME01']);
    const code = generateOrgCode('acme', existing);
    expect(code).toBe('ACME02');
  });

  it('returns first available code when none exist', () => {
    const existing = new Set<string>();
    const code = generateOrgCode('acme', existing);
    expect(code).toBe('ACME');
  });

  it('handles numeric slugs', () => {
    const code = generateOrgCode('12345');
    expect(code).toMatch(/^1234/);
  });
});

// ─── Structured ID generation ───────────────────────────────

describe('generateStructuredId', () => {
  it('produces format: ORG-ENTITY-<base62>', () => {
    const id = generateStructuredId('ACME', 'DL');
    expect(id).toMatch(/^ACME-DL-[0-9A-Za-z]{22}$/);
  });

  it('produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateStructuredId('ACME', 'DL'));
    }
    expect(ids.size).toBe(100);
  });

  it('throws on invalid org code', () => {
    expect(() => generateStructuredId('', 'DL')).toThrow();
    expect(() => generateStructuredId('A', 'DL')).toThrow();
  });

  it('throws on invalid entity code', () => {
    expect(() => generateStructuredId('ACME', '')).toThrow();
    expect(() => generateStructuredId('ACME', 'X')).toThrow();
  });
});

// ─── Structured ID parsing ──────────────────────────────────

describe('parseStructuredId', () => {
  it('parses valid structured ID', () => {
    const id = 'ACME-DL-2aUyqjCzEIiEcYMKj7TZtw';
    const parsed = parseStructuredId(id);
    expect(parsed).not.toBeNull();
    expect(parsed!.orgCode).toBe('ACME');
    expect(parsed!.entityCode).toBe('DL');
    expect(parsed!.uuid).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('returns null for plain UUID', () => {
    expect(parseStructuredId('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });

  it('returns null for malformed IDs', () => {
    expect(parseStructuredId('')).toBeNull();
    expect(parseStructuredId('ACME')).toBeNull();
    expect(parseStructuredId('ACME-DL')).toBeNull();
    expect(parseStructuredId('ACME-DL-short')).toBeNull();
  });

  it('returns null for invalid entity code', () => {
    expect(parseStructuredId('ACME-XX-4wr7jBDTEqVBCsXEih4zfP')).toBeNull();
  });

  it('round-trips generate → parse', () => {
    const id = generateStructuredId('ACME', 'CT');
    const parsed = parseStructuredId(id);
    expect(parsed).not.toBeNull();
    expect(parsed!.orgCode).toBe('ACME');
    expect(parsed!.entityCode).toBe('CT');
    expect(parsed!.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

// ─── isStructuredId ─────────────────────────────────────────

describe('isStructuredId', () => {
  it('returns true for structured IDs', () => {
    expect(isStructuredId('ACME-DL-2aUyqjCzEIiEcYMKj7TZtw')).toBe(true);
    expect(isStructuredId('BIGC-CT-2aUyqjCzEIiEcYMKj7TZtw')).toBe(true);
  });

  it('returns false for plain UUIDs', () => {
    expect(isStructuredId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('returns false for invalid formats', () => {
    expect(isStructuredId('')).toBe(false);
    expect(isStructuredId('ACME')).toBe(false);
    expect(isStructuredId('not-an-id')).toBe(false);
  });
});

// ─── ENTITY_CODES ───────────────────────────────────────────

describe('ENTITY_CODES', () => {
  it('includes common CRM entities', () => {
    expect(ENTITY_CODES).toHaveProperty('deal');
    expect(ENTITY_CODES).toHaveProperty('contact');
    expect(ENTITY_CODES).toHaveProperty('company');
    expect(ENTITY_CODES).toHaveProperty('lead');
    expect(ENTITY_CODES).toHaveProperty('task');
    expect(ENTITY_CODES).toHaveProperty('ticket');
    expect(ENTITY_CODES).toHaveProperty('invoice');
    expect(ENTITY_CODES).toHaveProperty('quote');
  });

  it('all entity codes are 2-3 uppercase chars', () => {
    for (const [, code] of Object.entries(ENTITY_CODES)) {
      expect(code).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it('all entity codes are unique', () => {
    const codes = Object.values(ENTITY_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
