import { describe, it, expect } from 'vitest';
import { generatePublicToken, publicOfferUrl, canTransition, readOfferMetadata } from '@/lib/offers';

describe('generatePublicToken', () => {
  it('returns a base64url string', () => {
    const token = generatePublicToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('generates unique tokens', () => {
    const t1 = generatePublicToken();
    const t2 = generatePublicToken();
    expect(t1).not.toBe(t2);
  });

  it('produces URL-safe characters only', () => {
    const token = generatePublicToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('publicOfferUrl', () => {
  const OLD = process.env;

  beforeEach(() => { process.env = { ...OLD }; });
  afterEach(() => { process.env = OLD; });

  it('uses APP_URL from env', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    const url = publicOfferUrl('abc123');
    expect(url).toBe('https://app.example.com/p/offers/abc123');
  });

  it('defaults to localhost', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const url = publicOfferUrl('test-token');
    expect(url).toBe('http://localhost:3000/p/offers/test-token');
  });

  it('strips trailing slash from base', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/';
    const url = publicOfferUrl('t');
    expect(url).toBe('https://example.com/p/offers/t');
  });
});

describe('canTransition', () => {
  it('allows draft -> sent', () => {
    expect(canTransition('draft', 'sent')).toBe(true);
  });

  it('allows sent -> viewed', () => {
    expect(canTransition('sent', 'viewed')).toBe(true);
  });

  it('allows sent -> accepted', () => {
    expect(canTransition('sent', 'accepted')).toBe(true);
  });

  it('allows sent -> declined', () => {
    expect(canTransition('sent', 'declined')).toBe(true);
  });

  it('allows draft -> cancelled', () => {
    expect(canTransition('draft', 'cancelled')).toBe(true);
  });

  it('disallows accepted -> sent', () => {
    expect(canTransition('accepted', 'sent')).toBe(false);
  });

  it('disallows declined -> sent', () => {
    expect(canTransition('declined', 'sent')).toBe(false);
  });

  it('disallows cancelled -> sent', () => {
    expect(canTransition('cancelled', 'sent')).toBe(false);
  });

  it('allows resend same status', () => {
    expect(canTransition('sent', 'sent')).toBe(true);
    expect(canTransition('viewed', 'viewed')).toBe(true);
  });

  it('returns false for unknown statuses', () => {
    expect(canTransition('draft', 'unknown' as any)).toBe(false);
  });
});

describe('readOfferMetadata', () => {
  it('returns empty object for null metadata', () => {
    expect(readOfferMetadata({ metadata: null })).toEqual({});
  });

  it('returns empty object for non-object metadata', () => {
    expect(readOfferMetadata({ metadata: 'string' })).toEqual({});
  });

  it('returns empty object when offer key is missing', () => {
    expect(readOfferMetadata({ metadata: { other: 1 } })).toEqual({});
  });

  it('reads offer metadata', () => {
    const result = readOfferMetadata({
      metadata: { offer: { public_token: 'tok_123', status: 'sent' } },
    });
    expect(result.public_token).toBe('tok_123');
  });
});
