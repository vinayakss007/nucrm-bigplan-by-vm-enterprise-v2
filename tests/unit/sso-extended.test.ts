import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 'user-1' }]) })) })),
    })),
    query: {
      users: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/drizzle/schema/infra', () => ({
  ssoProviders: {},
  ssoSessions: {},
}));

vi.mock('@/drizzle/schema/core', () => ({
  users: {},
  sessions: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => args),
  and: vi.fn((...args) => args),
}));

vi.mock('@/lib/auth/session', () => ({
  createToken: vi.fn(() => Promise.resolve('mock-jwt-token')),
  hashToken: vi.fn(() => Promise.resolve('mock-hash')),
}));

vi.mock('@/drizzle/schema', () => ({
  sessions: {},
}));

// Mock the OIDC module to avoid real HTTP calls
vi.mock('@/lib/auth/sso/oidc', () => ({
  exchangeAndVerify: vi.fn(),
  OidcError: class OidcError extends Error {
    constructor(code: string, message: string) {
      super(message);
      this.name = 'OidcError';
    }
  },
}));

describe('SSO - Extended Coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('generateSAMLMetadata', () => {
    it('includes correct XML structure', async () => {
      const { generateSAMLMetadata } = await import('@/lib/auth/sso');
      const xml = generateSAMLMetadata('t1', 'p1', {
        entityId: 'test-entity',
        ssoUrl: 'https://idp.test.com/sso',
        certificate: '',
        acsUrl: 'https://app.test.com/acs',
      });
      expect(xml).toContain('test-entity');
      expect(xml).toContain('https://app.test.com/acs');
      expect(xml).toContain('WantAssertionsSigned="true"');
    });

    it('escapes XML in entityId with special chars', async () => {
      const { generateSAMLMetadata } = await import('@/lib/auth/sso');
      const xml = generateSAMLMetadata('t1', 'p1', {
        entityId: 'test<entity>"quoted"',
        ssoUrl: 'https://idp.test.com/sso',
        certificate: '',
        acsUrl: 'https://app.test.com/acs',
      });
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&quot;');
      expect(xml).not.toContain('<entity>');
    });
  });

  describe('handleSSOCallback', () => {
    it('throws when state parameter mismatches', async () => {
      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        'tenant-1', 'provider-1',
        { state: 'wrong-state' },
        { expectedState: 'expected-state' }
      )).rejects.toThrow('Invalid SSO state');
    });

    it('throws when provider not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });

      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        'tenant-1', 'missing',
        { state: 's', SAMLResponse: 'dGVzdA==' },
        { expectedState: 's' }
      )).rejects.toThrow('SSO provider not found');
    });

    it('throws when SAML callback has no certificate', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{
            id: 'p1', tenantId: 't1', providerType: 'saml', name: 'Okta', isActive: true,
            config: { entityId: 'e', ssoUrl: 'u', certificate: '', acsUrl: 'a' },
          }])),
        })),
      });

      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        't1', 'p1',
        { state: 's', SAMLResponse: 'dGVzdA==' },
        { expectedState: 's' }
      )).rejects.toThrow('missing certificate');
    });

    it('throws when SAML assertion has no certificate', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{
            id: 'p1', tenantId: 't1', providerType: 'saml', name: 'Okta', isActive: true,
            config: { entityId: 'e', ssoUrl: 'u', certificate: '', acsUrl: 'a' },
          }])),
        })),
      });

      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        't1', 'p1',
        { state: 's', SAMLResponse: 'dGVzdA==' },
        { expectedState: 's' }
      )).rejects.toThrow('missing certificate');
    });

    it('throws when callback has no code or SAMLResponse', async () => {
      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        't1', 'p1',
        { state: 's' },
        { expectedState: 's' }
      )).rejects.toThrow('Invalid SSO callback');
    });

    it('creates new user and session for valid OIDC callback', async () => {
      const { exchangeAndVerify } = await import('@/lib/auth/sso/oidc');
      (exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ email: 'oidc-user@test.com', sub: 'sub-123' });

      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{
            id: 'p1', tenantId: 't1', providerType: 'oidc', name: 'Google', isActive: true,
            config: {
              issuer: '',
              clientId: 'client-123',
              clientSecret: 'secret',
              authorizationEndpoint: 'https://accounts.google.com/o/oauth2/auth',
              tokenEndpoint: 'https://oauth2.googleapis.com/token',
              userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
              redirectUri: 'https://nucrm.app/callback',
              scopes: ['openid', 'profile', 'email'],
            },
          }])),
        })),
      });
      (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'new-user-1', email: 'oidc-user@test.com', emailVerified: true }]),
        })),
      });

      const { handleSSOCallback } = await import('@/lib/auth/sso');
      const result = await handleSSOCallback(
        't1', 'p1',
        { state: 's', code: 'auth-code-123' },
        { expectedState: 's' }
      );
      expect(result.email).toBe('oidc-user@test.com');
      expect(result.token).toBe('mock-jwt-token');
    });

    it('handles OIDC error gracefully', async () => {
      const { exchangeAndVerify, OidcError } = await import('@/lib/auth/sso/oidc');
      (exchangeAndVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new OidcError('exchange_failed', 'Token exchange failed: 401'));

      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{
            id: 'p1', tenantId: 't1', providerType: 'oidc', name: 'Google', isActive: true,
            config: {
              issuer: '',
              clientId: 'c',
              clientSecret: 's',
              authorizationEndpoint: 'https://accounts.google.com/o/oauth2/auth',
              tokenEndpoint: 'https://oauth2.googleapis.com/token',
              userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
              redirectUri: 'https://nucrm.app/callback',
            },
          }])),
        })),
      });

      const { handleSSOCallback } = await import('@/lib/auth/sso');
      await expect(handleSSOCallback(
        't1', 'p1',
        { state: 's', code: 'bad-code' },
        { expectedState: 's' }
      )).rejects.toThrow('OIDC verification failed');
    });
  });

  describe('createSSOSession', () => {
    it('stores SSO session and returns it', async () => {
      const { db } = await import('@/drizzle/db');
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'sso-session-1', sessionId: 'sid-1', userId: 'u1' }]),
        })),
      });

      const { createSSOSession } = await import('@/lib/auth/sso');
      const result = await createSSOSession('u1', 't1', 'p1', {
        sessionId: 'sid-1',
        expiresAt: new Date(Date.now() + 86400000),
      });
      expect(result.sessionId).toBe('sid-1');
    });
  });

  describe('validateOIDCToken - extended', () => {
    it('returns invalid for non-3-part token', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');
      const result = await validateOIDCToken('invalid', {} as Parameters<typeof validateOIDCToken>[1]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid token format');
    });

    it('returns invalid for malformed base64 payload', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');
      const result = await validateOIDCToken('a.!!!.c', {} as Parameters<typeof validateOIDCToken>[1]);
      expect(result.valid).toBe(false);
    });
  });
});
