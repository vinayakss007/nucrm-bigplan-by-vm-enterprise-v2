import { describe, it, expect } from 'vitest';
import { computeHash, computeEntryHash } from '@/lib/audit';

describe('computeHash', () => {
  it('produces a deterministic SHA-256 hex string', () => {
    const payload = { action: 'create', entityType: 'contact' };
    const hash1 = computeHash(payload);
    const hash2 = computeHash(payload);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
  });

  it('produces different hashes for different payloads', () => {
    const hash1 = computeHash({ action: 'create', entityType: 'contact' });
    const hash2 = computeHash({ action: 'delete', entityType: 'contact' });
    expect(hash1).not.toBe(hash2);
  });

  it('is order-independent due to sorted keys', () => {
    const hash1 = computeHash({ b: 2, a: 1 });
    const hash2 = computeHash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it('handles empty object', () => {
    const hash = computeHash({});
    expect(hash).toHaveLength(64);
    // Should be deterministic
    expect(hash).toBe(computeHash({}));
  });

  it('handles nested objects', () => {
    const payload = { data: { nested: true }, action: 'update' };
    const hash = computeHash(payload);
    expect(hash).toHaveLength(64);
  });

  it('handles null values in payload', () => {
    const hash1 = computeHash({ key: null });
    const hash2 = computeHash({ key: 'value' });
    expect(hash1).not.toBe(hash2);
  });

  it('normalizes undefined to null (#1281 canonicalization)', () => {
    const hashNull = computeHash({ key: null });
    const hashUndefined = computeHash({ key: undefined });
    // Canonicalization treats undefined as null so payloads that only differ
    // by JSON's undefined-dropping behavior hash consistently.
    expect(hashNull).toBe(hashUndefined);
  });
});

describe('computeEntryHash', () => {
  const baseEntry = {
    tenantId: 'tenant-001',
    userId: 'user-123',
    action: 'create',
    entityType: 'contact',
    entityId: 'contact-456',
    oldData: null,
    newData: { name: 'Alice', email: 'alice@example.com' },
    metadata: { source: 'api' },
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    previousHash: null,
  };

  it('produces a deterministic 64-character hex hash', () => {
    const hash1 = computeEntryHash(baseEntry);
    const hash2 = computeEntryHash(baseEntry);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('changes when tenantId differs', () => {
    const modified = { ...baseEntry, tenantId: 'tenant-002' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when userId differs', () => {
    const modified = { ...baseEntry, userId: 'user-999' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when action differs', () => {
    const modified = { ...baseEntry, action: 'delete' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when entityType differs', () => {
    const modified = { ...baseEntry, entityType: 'deal' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when entityId differs', () => {
    const modified = { ...baseEntry, entityId: 'contact-789' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when oldData changes type (null vs object)', () => {
    // null vs an object are serialized differently even with the replacer
    const modified = { ...baseEntry, oldData: { name: 'Bob' } };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when newData nested values differ (#1281: nested content is hashed)', () => {
    // Post-#1281 the payload is fully canonicalized, so nested object contents
    // ARE part of the digest — tampering with nested data is now detectable.
    const modified = { ...baseEntry, newData: { name: 'Bob', email: 'bob@example.com' } };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when metadata nested content differs (#1281)', () => {
    const withMetadata = { ...baseEntry, metadata: { source: 'api' } };
    const withEmptyMetadata = { ...baseEntry, metadata: {} };
    // Nested metadata content is now included in the hash, so these differ.
    expect(computeEntryHash(withMetadata)).not.toBe(computeEntryHash(withEmptyMetadata));
  });

  it('is independent of nested key order (#1281 canonicalization)', () => {
    const a = { ...baseEntry, newData: { name: 'Alice', email: 'alice@example.com' } };
    const b = { ...baseEntry, newData: { email: 'alice@example.com', name: 'Alice' } };
    // Reordering nested keys must NOT change the hash (no false tamper alarms).
    expect(computeEntryHash(a)).toBe(computeEntryHash(b));
  });

  it('changes when ipAddress differs', () => {
    const modified = { ...baseEntry, ipAddress: '10.0.0.1' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when userAgent differs', () => {
    const modified = { ...baseEntry, userAgent: 'curl/7.88' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('changes when previousHash differs', () => {
    const modified = { ...baseEntry, previousHash: 'abc123def456' };
    expect(computeEntryHash(baseEntry)).not.toBe(computeEntryHash(modified));
  });

  it('handles all-null optional fields', () => {
    const entry = {
      tenantId: 'tenant-001',
      userId: null,
      action: 'login',
      entityType: 'session',
      entityId: null,
      oldData: null,
      newData: null,
      metadata: {},
      ipAddress: null,
      userAgent: null,
      previousHash: null,
    };
    const hash = computeEntryHash(entry);
    expect(hash).toHaveLength(64);
    // Deterministic
    expect(hash).toBe(computeEntryHash(entry));
  });

  it('chains correctly with previousHash linking entries', () => {
    const firstHash = computeEntryHash(baseEntry);
    const secondEntry = {
      ...baseEntry,
      action: 'update',
      oldData: { name: 'Alice' },
      newData: { name: 'Alicia' },
      previousHash: firstHash,
    };
    const secondHash = computeEntryHash(secondEntry);
    expect(secondHash).toHaveLength(64);
    expect(secondHash).not.toBe(firstHash);
  });
});
