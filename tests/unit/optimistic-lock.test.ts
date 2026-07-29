/**
 * Tests for the optimistic concurrency guard (#680).
 *
 * The guard's whole job is to stop a lost update, so the cases that matter are
 * the ones where it might quietly decline to do that: no version sent, a
 * version that cannot be parsed, a row with no updatedAt. Two of those
 * originally returned `null` (= "no conflict, proceed"), which is
 * indistinguishable to the caller from a verified-safe write.
 */
import { describe, it, expect } from 'vitest';
import { checkConcurrency, clientVersion } from '@/lib/api/optimistic-lock';

const NOW = new Date('2026-07-29T12:00:00.000Z');

describe('checkConcurrency', () => {
  it('allows the write when the client version matches exactly', () => {
    expect(checkConcurrency(NOW, NOW.toISOString())).toBeNull();
  });

  it('allows the write for an equivalent timestamp in another format', () => {
    // Same instant, different serialisation — compared by epoch ms, not string.
    expect(checkConcurrency(NOW, 'Wed, 29 Jul 2026 12:00:00 GMT')).toBeNull();
  });

  it('rejects with 409 when the record moved on', async () => {
    const res = checkConcurrency(NOW, '2026-07-29T11:59:59.000Z');
    expect(res?.status).toBe(409);
    const body = await res!.json();
    expect(body.code).toBe('CONFLICT');
    // The client needs both sides to show a useful diff / refresh prompt.
    expect(body.server_updated_at).toBe(NOW.toISOString());
    expect(body.client_updated_at).toBe('2026-07-29T11:59:59.000Z');
  });

  it('detects a difference of a single millisecond', async () => {
    const res = checkConcurrency(NOW, new Date(NOW.getTime() + 1).toISOString());
    expect(res?.status).toBe(409);
  });

  it('skips the check when the client sends no version (opt-in)', () => {
    expect(checkConcurrency(NOW, undefined)).toBeNull();
    expect(checkConcurrency(NOW, null)).toBeNull();
    expect(checkConcurrency(NOW, '')).toBeNull();
  });

  it('rejects an unparseable version with 400 rather than skipping it', async () => {
    // This is the important one. Returning null here would leave a client that
    // believes it is protected with no protection at all.
    const res = checkConcurrency(NOW, 'not-a-date');
    expect(res?.status).toBe(400);
    const body = await res!.json();
    expect(body.code).toBe('INVALID_VERSION');
    expect(body.client_version).toBe('not-a-date');
  });

  it('treats a numeric-looking string that Date cannot parse as invalid', async () => {
    const res = checkConcurrency(NOW, '99-99-99');
    expect(res?.status).toBe(400);
  });

  it('does not throw when the row has no updatedAt', () => {
    // A non-null assertion here would call .getTime() on null and surface as a
    // 500 instead of a handled response.
    expect(() => checkConcurrency(null, NOW.toISOString())).not.toThrow();
    expect(checkConcurrency(null, NOW.toISOString())).toBeNull();
    expect(checkConcurrency(undefined, NOW.toISOString())).toBeNull();
  });
});

describe('clientVersion', () => {
  it('reads the canonical _updated_at', () => {
    expect(clientVersion({ _updated_at: 'a' })).toBe('a');
  });

  it('also accepts _version and updated_at', () => {
    // Both spellings shipped in parallel PRs; accepting all three means no
    // client silently loses protection by sending the "wrong" key.
    expect(clientVersion({ _version: 'b' })).toBe('b');
    expect(clientVersion({ updated_at: 'c' })).toBe('c');
  });

  it('prefers _updated_at over the aliases', () => {
    expect(clientVersion({ updated_at: 'c', _version: 'b', _updated_at: 'a' })).toBe('a');
  });

  it('returns undefined when no version key is present', () => {
    expect(clientVersion({ title: 'x' })).toBeUndefined();
  });

  it('ignores non-string and empty values', () => {
    expect(clientVersion({ _updated_at: 123 })).toBeUndefined();
    expect(clientVersion({ _updated_at: '' })).toBeUndefined();
    expect(clientVersion({ _updated_at: null })).toBeUndefined();
  });

  it('handles a non-object body without throwing', () => {
    expect(clientVersion(null)).toBeUndefined();
    expect(clientVersion(undefined)).toBeUndefined();
    expect(clientVersion('string')).toBeUndefined();
  });
});
