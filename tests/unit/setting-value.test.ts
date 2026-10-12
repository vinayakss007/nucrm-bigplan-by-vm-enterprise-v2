import { describe, it, expect } from 'vitest';
import { decodeSettingValue } from '@/lib/api/setting-value';

// `platform_settings.value` is jsonb, so the driver returns a decoded value.
// The read paths used to do JSON.parse(String(value)); for an array that
// stringifies through Array.prototype.join ("203.0.113.9"), and JSON.parse
// threw — every settings GET 500'd on a value that had just saved fine.
describe('decodeSettingValue', () => {
  it('passes a decoded jsonb array straight through', () => {
    expect(decodeSettingValue(['203.0.113.9', '198.51.100.7'], [], 'array')).toEqual([
      '203.0.113.9',
      '198.51.100.7',
    ]);
  });

  it('passes a decoded jsonb object straight through', () => {
    expect(decodeSettingValue({ enabled: true }, { enabled: false }, 'object')).toEqual({
      enabled: true,
    });
  });

  it('still parses a JSON document parked in a jsonb string', () => {
    expect(decodeSettingValue('["203.0.113.9"]', [], 'array')).toEqual(['203.0.113.9']);
    expect(decodeSettingValue('{"enabled":true}', {}, 'object')).toEqual({ enabled: true });
  });

  it('returns the fallback for an absent value', () => {
    expect(decodeSettingValue(null, [], 'array')).toEqual([]);
    expect(decodeSettingValue(undefined, { a: 1 }, 'object')).toEqual({ a: 1 });
    expect(decodeSettingValue('', [], 'array')).toEqual([]);
  });

  it('returns the fallback instead of throwing on malformed text', () => {
    expect(decodeSettingValue('not json', [], 'array')).toEqual([]);
  });

  it('returns the fallback when the stored shape is not what the caller expects', () => {
    // A super admin can write any key; a reader must not get a TypeError several
    // statements later because the row holds an object where an array was asked
    // for.
    expect(decodeSettingValue({ a: 1 }, [], 'array')).toEqual([]);
    expect(decodeSettingValue([1, 2], {}, 'object')).toEqual({});
    expect(decodeSettingValue(45, [], 'array')).toEqual([]);
  });

  it('keeps an empty array/object as-is rather than substituting the fallback', () => {
    expect(decodeSettingValue([], ['x'], 'array')).toEqual([]);
    expect(decodeSettingValue({}, { a: 1 }, 'object')).toEqual({});
  });
});
