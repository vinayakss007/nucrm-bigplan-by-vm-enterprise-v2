import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'session-1', sessionId: 'sid-123', userId: 'user-1', tenantId: 'tenant-1', providerId: 'provider-1' }]),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/infra', () => ({
  ssoProviders: {
    id: 'id',
    tenantId: 'tenant_id',
    providerType: 'provider_type',
    name: 'name',
    config: 'config',
    isActive: 'is_active',
  },
  ssoSessions: {
    userId: 'user_id',
    tenantId: 'tenant_id',
    providerId: 'provider_id',
    sessionId: 'session_id',
    idToken: 'id_token',
    samlAssertion: 'saml_assertion',
    expiresAt: 'expires_at',
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  users: {
    id: 'id',
    email: 'email',
    emailVerified: 'email_verified',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

describe('SSO - SAML Metadata', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('generateSAMLMetadata', () => {
    it('produces valid XML with EntityDescriptor', async () => {
      const { generateSAMLMetadata } = await import('@/lib/auth/sso');

      const config = {
        entityId: 'https://nucrm.app/saml/metadata',
        ssoUrl: 'https://idp.example.com/sso',
        certificate: 'MIIC...',
        acsUrl: 'https://nucrm.app/api/auth/sso/provider-1',
        nameIdFormat: 'email',
      };

      const xml = generateSAMLMetadata('tenant-1', 'provider-1', config);
      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('md:EntityDescriptor');
      expect(xml).toContain('md:SPSSODescriptor');
      expect(xml).toContain('md:AssertionConsumerService');
      expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:metadata');
      expect(xml).toContain('https://nucrm.app/saml/metadata');
      expect(xml).toContain('https://nucrm.app/api/auth/sso/provider-1');
    });

    it('escapes XML special characters in entityId', async () => {
      const { generateSAMLMetadata } = await import('@/lib/auth/sso');

      const config = {
        entityId: 'https://nucrm.app/saml?tenant=1&type=sp',
        ssoUrl: 'https://idp.example.com/sso',
        certificate: 'MIIC...',
        acsUrl: 'https://nucrm.app/api/auth/sso/p1',
      };

      const xml = generateSAMLMetadata('tenant-1', 'p1', config);
      expect(xml).toContain('&amp;');
      expect(xml).not.toContain('tenant=1&type');
    });
  });
});

describe('SSO - OIDC Token Validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('validateOIDCToken', () => {
    const config = {
      issuer: 'https://accounts.google.com',
      clientId: 'my-client-id',
      clientSecret: 'secret',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
      redirectUri: 'https://nucrm.app/api/auth/sso/google',
    };

    function createToken(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64');
      return `${header}.${body}.fake-signature`;
    }

    it('rejects expired tokens', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');

      const token = createToken({
        iss: 'https://accounts.google.com',
        aud: 'my-client-id',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        sub: 'user-123',
        email: 'user@example.com',
      });

      const result = validateOIDCToken(token, config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('rejects tokens with wrong issuer', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');

      const token = createToken({
        iss: 'https://evil.com',
        aud: 'my-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'user-123',
      });

      const result = validateOIDCToken(token, config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('issuer');
    });

    it('rejects tokens with wrong audience', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');

      const token = createToken({
        iss: 'https://accounts.google.com',
        aud: 'wrong-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'user-123',
      });

      const result = validateOIDCToken(token, config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('audience');
    });

    it('validates a correct token', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');

      const token = createToken({
        iss: 'https://accounts.google.com',
        aud: 'my-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'user-123',
        email: 'user@example.com',
      });

      const result = validateOIDCToken(token, config);
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!['email']).toBe('user@example.com');
    });

    it('rejects malformed tokens', async () => {
      const { validateOIDCToken } = await import('@/lib/auth/sso');
      const result = validateOIDCToken('not.a.valid.jwt.token', config);
      expect(result.valid).toBe(false);
    });
  });
});

describe('SSO - Initiate SSO', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('generates correct OIDC redirect URL', async () => {
    const { db } = await import('@/drizzle/db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => [{
          id: 'provider-1',
          tenantId: 'tenant-1',
          providerType: 'oidc',
          name: 'Google',
          config: {
            issuer: 'https://accounts.google.com',
            clientId: 'client-123',
            clientSecret: 'secret',
            authorizationEndpoint: 'https://accounts.google.com/o/oauth2/auth',
            tokenEndpoint: 'https://oauth2.googleapis.com/token',
            userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
            redirectUri: 'https://nucrm.app/callback',
            scopes: ['openid', 'profile', 'email'],
          },
          isActive: true,
        }]),
      })),
    });

    const { initiateSSO } = await import('@/lib/auth/sso');
    const result = await initiateSSO('tenant-1', 'provider-1');

    expect(result.redirectUrl).toContain('https://accounts.google.com/o/oauth2/auth');
    expect(result.redirectUrl).toContain('client_id=client-123');
    expect(result.redirectUrl).toContain('response_type=code');
    expect(result.redirectUrl).toContain('scope=');
    expect(result.redirectUrl).toContain('state=');
    expect(result.state).toBeDefined();
  });

  it('generates correct SAML redirect URL', async () => {
    const { db } = await import('@/drizzle/db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => [{
          id: 'provider-2',
          tenantId: 'tenant-1',
          providerType: 'saml',
          name: 'Okta',
          config: {
            entityId: 'https://nucrm.app/saml',
            ssoUrl: 'https://okta.example.com/sso/saml',
            certificate: 'MIIC...',
            acsUrl: 'https://nucrm.app/api/auth/sso/provider-2',
          },
          isActive: true,
        }]),
      })),
    });

    const { initiateSSO } = await import('@/lib/auth/sso');
    const result = await initiateSSO('tenant-1', 'provider-2');

    expect(result.redirectUrl).toContain('https://okta.example.com/sso/saml');
    expect(result.redirectUrl).toContain('SAMLRequest=');
    expect(result.redirectUrl).toContain('RelayState=');
    expect(result.state).toBeDefined();
  });

  it('throws when provider not found', async () => {
    const { db } = await import('@/drizzle/db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => []),
      })),
    });

    const { initiateSSO } = await import('@/lib/auth/sso');
    await expect(initiateSSO('tenant-1', 'nonexistent')).rejects.toThrow('SSO provider not found');
  });
});
