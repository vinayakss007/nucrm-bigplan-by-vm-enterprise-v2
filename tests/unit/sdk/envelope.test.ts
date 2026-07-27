import { describe, it, expect } from 'vitest';
import { unwrapEnvelope } from '@/lib/sdk/envelope';

/**
 * The SDK returned `response.json() as T` without unwrapping, while typing the
 * result as the bare entity. Since single-entity routes answer `{ data: entity }`,
 * `sdk.contacts.get(id).firstName` was undefined for every wrapped resource.
 *
 * The unwrap rule has to distinguish a single-entity envelope from a paginated
 * one, because callers need the whole paginated object.
 */
describe('SDK response envelope', () => {
  describe('single-entity envelopes are unwrapped', () => {
    it('returns the inner entity', () => {
      const contact = { id: 'c1', firstName: 'Ada' };
      expect(unwrapEnvelope<typeof contact>({ data: contact })).toEqual(contact);
    });

    it('unwraps a null payload', () => {
      expect(unwrapEnvelope({ data: null })).toBeNull();
    });

    it('unwraps an array payload', () => {
      expect(unwrapEnvelope({ data: [1, 2, 3] })).toEqual([1, 2, 3]);
    });
  });

  describe('paginated envelopes are left intact', () => {
    // List routes answer { data, total, offset, limit } and the caller needs all
    // of it. Unwrapping here would silently discard pagination.
    it('keeps the wrapper when siblings are present', () => {
      const page = { data: [{ id: 'c1' }], total: 42, offset: 0, limit: 25 };
      expect(unwrapEnvelope(page)).toEqual(page);
    });

    it('keeps the wrapper even for an empty page', () => {
      const page = { data: [], total: 0, offset: 0, limit: 25 };
      expect(unwrapEnvelope(page)).toEqual(page);
    });
  });

  describe('non-envelope bodies pass through', () => {
    it('leaves a flat entity alone', () => {
      const flat = { id: 'l1', firstName: 'Grace' };
      expect(unwrapEnvelope(flat)).toEqual(flat);
    });

    it('leaves a bare array alone', () => {
      expect(unwrapEnvelope([{ id: 1 }])).toEqual([{ id: 1 }]);
    });

    it('leaves a { success } acknowledgement alone', () => {
      expect(unwrapEnvelope({ success: true })).toEqual({ success: true });
    });

    it.each([null, undefined, 0, '', 'text', false])('leaves %j alone', (value) => {
      expect(unwrapEnvelope(value)).toEqual(value);
    });

    it('does not unwrap an object that merely contains data among others', () => {
      const body = { data: { id: 1 }, meta: { cached: true } };
      expect(unwrapEnvelope(body)).toEqual(body);
    });
  });

  describe('entities that themselves have a data field', () => {
    // The check inspects the top-level object only, so an entity with its own
    // `data` property survives one unwrap and is not stripped twice.
    it('unwraps once, leaving the entity data field intact', () => {
      const entity = { id: 'f1', data: { field: 'value' } };
      const result = unwrapEnvelope<typeof entity>({ data: entity });
      expect(result).toEqual(entity);
      expect(result.data).toEqual({ field: 'value' });
    });
  });
});
