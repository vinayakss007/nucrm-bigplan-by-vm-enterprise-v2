import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const { mockCookieGet } = vi.hoisted(() => ({ mockCookieGet: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookieGet }),
}));

const portalClientRow = {
  id: 'client-1',
  tenantId: 'tenant-1',
  email: 'client@example.com',
  name: 'Client One',
  accessToken: 'live-token',
  isActive: true,
  expiresAt: new Date(Date.now() + 86_400_000),
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [portalClientRow]),
        })),
      })),
    })),
  },
}));

import {
  encodePortalSessionCookie,
  portalSessionCookieOptions,
  getPortalSession,
} from '@/lib/portal-session';

describe('portal-session (#1326)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('encodes email/tenant/sha256(token) into a base64url payload', () => {
    const enc = encodePortalSessionCookie('a@b.com', 't-1', 'tok-123');
    const payload = JSON.parse(Buffer.from(enc, 'base64url').toString());
    expect(payload.email).toBe('a@b.com');
    expect(payload.tenantId).toBe('t-1');
    expect(payload.tokenHash).toBe(createHash('sha256').update('tok-123').digest('hex'));
  });

  it('cookie options are httpOnly + sameSite lax with expiry', () => {
    const exp = new Date('2027-01-01T00:00:00Z');
    const opts = portalSessionCookieOptions(exp);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.expires).toBe(exp);
  });

  it('getPortalSession returns null when cookie absent', async () => {
    mockCookieGet.mockReturnValue(undefined);
    expect(await getPortalSession()).toBeNull();
  });

  it('returns client info for a valid session cookie', async () => {
    const enc = encodePortalSessionCookie('client@example.com', 'tenant-1', 'live-token');
    mockCookieGet.mockReturnValue({ value: enc });
    const info = await getPortalSession();
    expect(info).toEqual({
      clientId: 'client-1',
      tenantId: 'tenant-1',
      name: 'Client One',
      email: 'client@example.com',
    });
  });

  it('returns null when the stored token hash does not match', async () => {
    const enc = encodePortalSessionCookie('client@example.com', 'tenant-1', 'stale-token');
    mockCookieGet.mockReturnValue({ value: enc });
    expect(await getPortalSession()).toBeNull();
  });

  it('returns null when the client is inactive', async () => {
    portalClientRow.isActive = false;
    const enc = encodePortalSessionCookie('client@example.com', 'tenant-1', 'live-token');
    mockCookieGet.mockReturnValue({ value: enc });
    expect(await getPortalSession()).toBeNull();
    portalClientRow.isActive = true;
  });

  it('returns null when the grant is expired', async () => {
    portalClientRow.expiresAt = new Date(Date.now() - 1000);
    const enc = encodePortalSessionCookie('client@example.com', 'tenant-1', 'live-token');
    mockCookieGet.mockReturnValue({ value: enc });
    expect(await getPortalSession()).toBeNull();
    portalClientRow.expiresAt = new Date(Date.now() + 86_400_000);
  });
});
