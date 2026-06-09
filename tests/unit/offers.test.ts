import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePublicToken, publicOfferUrl, canTransition, readOfferMetadata } from '@/lib/offers';

const mockDbQueryFindFirst = vi.fn();
const mockDbWhereFn = vi.fn().mockResolvedValue(undefined);

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      quotes: {
        findFirst: (...args: any[]) => mockDbQueryFindFirst(...args),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: (...args: any[]) => mockDbWhereFn(...args),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  quotes: { id: 'id', tenantId: 'tenantId', metadata: 'metadata', deletedAt: 'deletedAt', updatedAt: 'updatedAt' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ op: 'eq', a, b }),
  and: (...args: any[]) => ({ op: 'and', args }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ sql: strings.join('?'), values }),
  isNull: (a: any) => ({ op: 'isNull', a }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('allows sent -> expired', () => {
    expect(canTransition('sent', 'expired')).toBe(true);
  });

  it('allows draft -> cancelled', () => {
    expect(canTransition('draft', 'cancelled')).toBe(true);
  });

  it('allows sent -> cancelled', () => {
    expect(canTransition('sent', 'cancelled')).toBe(true);
  });

  it('allows viewed -> cancelled', () => {
    expect(canTransition('viewed', 'cancelled')).toBe(true);
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

  it('disallows expired -> sent', () => {
    expect(canTransition('expired', 'sent')).toBe(false);
  });

  it('allows resend same status', () => {
    expect(canTransition('sent', 'sent')).toBe(true);
    expect(canTransition('viewed', 'viewed')).toBe(true);
  });

  it('returns false for unknown target status', () => {
    expect(canTransition('draft', 'unknown' as any)).toBe(false);
  });

  it('disallows draft -> accepted', () => {
    expect(canTransition('draft', 'accepted')).toBe(false);
  });

  it('disallows draft -> expired', () => {
    expect(canTransition('draft', 'expired')).toBe(false);
  });

  it('disallows deleted -> sent', () => {
    expect(canTransition('deleted', 'sent')).toBe(false);
  });
});

describe('readOfferMetadata', () => {
  it('returns empty object for null metadata', () => {
    expect(readOfferMetadata({ metadata: null })).toEqual({});
  });

  it('returns empty object for undefined metadata', () => {
    expect(readOfferMetadata({ metadata: undefined })).toEqual({});
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

  it('returns empty object for null metadata offer', () => {
    expect(readOfferMetadata({ metadata: { offer: null } })).toEqual({});
  });
});

describe('findOfferByToken', () => {
  it('returns null for short tokens', async () => {
    const { findOfferByToken } = await import('@/lib/offers');
    const result = await findOfferByToken('short');
    expect(result).toBeNull();
    expect(mockDbQueryFindFirst).not.toHaveBeenCalled();
  });

  it('returns null for empty token', async () => {
    const { findOfferByToken } = await import('@/lib/offers');
    const result = await findOfferByToken('');
    expect(result).toBeNull();
  });

  it('queries database for valid token', async () => {
    mockDbQueryFindFirst.mockResolvedValue({ id: 'q1', metadata: { offer: { public_token: 'valid-token-1234567890123456' } } });
    const { findOfferByToken } = await import('@/lib/offers');
    const result = await findOfferByToken('valid-token-1234567890123456');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('q1');
  });

  it('returns null when no matching offer', async () => {
    mockDbQueryFindFirst.mockResolvedValue(null);
    const { findOfferByToken } = await import('@/lib/offers');
    const result = await findOfferByToken('nonexistent-token-1234567890');
    expect(result).toBeNull();
  });
});

describe('patchOfferMetadata', () => {
  it('updates offer metadata', async () => {
    const { patchOfferMetadata } = await import('@/lib/offers');
    await expect(patchOfferMetadata('q1', 't1', { public_token: 'tok_new' })).resolves.not.toThrow();
    expect(mockDbWhereFn).toHaveBeenCalled();
  });
});
