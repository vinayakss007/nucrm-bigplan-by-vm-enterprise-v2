import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe-token';

describe('unsubscribe-token', () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = 'test-secret';
    delete process.env.NEXTAUTH_SECRET;
  });

  it('generateUnsubscribeToken produces a stable hex HMAC for a contact', () => {
    const a = generateUnsubscribeToken('contact-123');
    const b = generateUnsubscribeToken('contact-123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different contacts produce different tokens', () => {
    expect(generateUnsubscribeToken('contact-a')).not.toBe(
      generateUnsubscribeToken('contact-b'),
    );
  });

  it('verifyUnsubscribeToken accepts a token it generated', () => {
    const token = generateUnsubscribeToken('contact-123');
    expect(verifyUnsubscribeToken('contact-123', token)).toBe(true);
  });

  it('verifyUnsubscribeToken rejects a token for a different contact', () => {
    const token = generateUnsubscribeToken('contact-123');
    expect(verifyUnsubscribeToken('contact-999', token)).toBe(false);
  });

  it('verifyUnsubscribeToken rejects a missing token', () => {
    expect(verifyUnsubscribeToken('contact-123', null)).toBe(false);
    expect(verifyUnsubscribeToken('contact-123', undefined)).toBe(false);
    expect(verifyUnsubscribeToken('contact-123', '')).toBe(false);
  });

  it('verifyUnsubscribeToken rejects a token of the wrong length (no throw)', () => {
    expect(verifyUnsubscribeToken('contact-123', 'deadbeef')).toBe(false);
  });

  it('verifyUnsubscribeToken rejects a forged same-length token', () => {
    const token = generateUnsubscribeToken('contact-123');
    const forged = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyUnsubscribeToken('contact-123', forged)).toBe(false);
  });

  it('falls back to NEXTAUTH_SECRET when UNSUBSCRIBE_SECRET is unset', () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    process.env.NEXTAUTH_SECRET = 'nextauth-secret';
    const token = generateUnsubscribeToken('contact-123');
    expect(verifyUnsubscribeToken('contact-123', token)).toBe(true);
  });

  it('generate throws and verify fails closed when no secret is configured', () => {
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => generateUnsubscribeToken('contact-123')).toThrow(
      'Unsubscribe secret not configured',
    );
    expect(verifyUnsubscribeToken('contact-123', 'anytoken')).toBe(false);
  });
});
