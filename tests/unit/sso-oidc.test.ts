import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockJwtVerify = vi.fn();
const mockCreateRemoteJWKSet = vi.fn(() => 'mock-jwks');

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
}));

const origEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...origEnv };
});

afterEach(() => {
  process.env = { ...origEnv };
});

describe('OidcError', () => {
  it('sets code, message, and details', async () => {
    const { OidcError } = await import('@/lib/auth/sso/oidc');
    const err = new OidcError('test_code', 'test message', { foo: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OidcError);
    expect(err.name).toBe('OidcError');
    expect(err.code).toBe('test_code');
    expect(err.message).toBe('test message');
    expect(err.details).toEqual({ foo: 1 });
  });

  it('defaults details to undefined', async () => {
    const { OidcError } = await import('@/lib/auth/sso/oidc');
    const err = new OidcError('err', 'msg');
    expect(err.details).toBeUndefined();
  });
});

describe('randomToken', () => {
  it('returns a URL-safe base64 string of the requested byte length', async () => {
    const { randomToken } = await import('@/lib/auth/sso/oidc');
    const tok = randomToken(16);
    expect(tok).toEqual(expect.any(String));
    expect(tok).not.toContain('+');
    expect(tok).not.toContain('/');
    expect(tok).not.toContain('=');
  });

  it('defaults to 32 bytes when no argument given', async () => {
    const { randomToken } = await import('@/lib/auth/sso/oidc');
    const tok = randomToken();
    expect(tok).toEqual(expect.any(String));
    expect(tok.length).toBeGreaterThan(32);
  });

  it('uses crypto.getRandomValues', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const { randomToken } = await import('@/lib/auth/sso/oidc');
    randomToken(8);
    expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(8);
  });
});

describe('domainsFor', () => {
  it('lower-cases and trims each domain', async () => {
    const { domainsFor } = await import('@/lib/auth/sso/oidc');
    const result = domainsFor({
      issuer: 'https://example.com',
      client_id: 'x',
      client_secret: 's',
      email_domains: ['  ACME.COM ', 'Example.Org  '],
    });
    expect(result).toEqual(['acme.com', 'example.org']);
  });

  it('filters out empty strings', async () => {
    const { domainsFor } = await import('@/lib/auth/sso/oidc');
    const result = domainsFor({
      issuer: 'https://example.com',
      client_id: 'x',
      client_secret: 's',
      email_domains: ['foo.com', '', '  '],
    });
    expect(result).toEqual(['foo.com']);
  });

  it('returns an empty array when email_domains is not an array', async () => {
    const { domainsFor } = await import('@/lib/auth/sso/oidc');
    expect(domainsFor({ issuer: 'x', client_id: 'x', client_secret: 's' })).toEqual([]);
    expect(
      domainsFor({ issuer: 'x', client_id: 'x', client_secret: 's', email_domains: undefined }),
    ).toEqual([]);
    expect(
      domainsFor({ issuer: 'x', client_id: 'x', client_secret: 's', email_domains: 'not-an-array' as unknown as string[] }),
    ).toEqual([]);
  });
});

describe('discover', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fetches the well-known endpoint and returns a parsed discovery doc', async () => {
    const fakeDoc = {
      issuer: 'https://accounts.example.com',
      authorization_endpoint: 'https://accounts.example.com/o/oauth2/auth',
      token_endpoint: 'https://oauth2.example.com/token',
      jwks_uri: 'https://oauth2.example.com/certs',
    };
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fakeDoc,
    } as Response);

    const { discover } = await import('@/lib/auth/sso/oidc');
    const result = await discover('https://accounts.example.com');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.example.com/.well-known/openid-configuration',
      { headers: { Accept: 'application/json' } },
    );
    expect(result).toEqual(fakeDoc);
    mockFetch.mockRestore();
  });

  it('strips trailing slash from issuer before appending path', async () => {
    const fakeDoc = {
      authorization_endpoint: 'https://idp.example.com/auth',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/certs',
    };
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fakeDoc,
    } as Response);

    const { discover } = await import('@/lib/auth/sso/oidc');
    await discover('https://idp.example.com/');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://idp.example.com/.well-known/openid-configuration',
      expect.anything(),
    );
    mockFetch.mockRestore();
  });

  it('throws OidcError when the HTTP response is not ok', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { discover, OidcError } = await import('@/lib/auth/sso/oidc');
    await expect(discover('https://unknown.example.com')).rejects.toThrow(OidcError);
    await expect(discover('https://unknown.example.com')).rejects.toMatchObject({
      code: 'discovery_failed',
    });
    mockFetch.mockRestore();
  });

  it('throws OidcError when discovery doc is missing required fields', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ issuer: 'https://idp.example.com' }),
    } as Response);

    const { discover, OidcError } = await import('@/lib/auth/sso/oidc');
    await expect(discover('https://idp.example.com')).rejects.toThrow(OidcError);
    await expect(discover('https://idp.example.com')).rejects.toMatchObject({
      code: 'discovery_invalid',
    });
    mockFetch.mockRestore();
  });

  it('uses the issuer from the doc if present, falling back to the query issuer', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/auth',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/certs',
      }),
    } as Response);

    const { discover } = await import('@/lib/auth/sso/oidc');
    const result = await discover('https://idp.example.com');
    expect(result.issuer).toBe('https://idp.example.com');
    mockFetch.mockRestore();
  });

  it('returns cached doc within TTL without fetching', async () => {
    const fakeDoc = {
      issuer: 'https://cached.example.com',
      authorization_endpoint: 'https://cached.example.com/auth',
      token_endpoint: 'https://cached.example.com/token',
      jwks_uri: 'https://cached.example.com/certs',
    };
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fakeDoc,
    } as Response);

    const { discover } = await import('@/lib/auth/sso/oidc');
    const first = await discover('https://cached.example.com');
    const second = await discover('https://cached.example.com');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    mockFetch.mockRestore();
  });
});

describe('getAuthorizeUrl', () => {
  it('builds a correct authorization URL with all params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/oauth/authorize',
        token_endpoint: 'https://idp.example.com/oauth/token',
        jwks_uri: 'https://idp.example.com/oauth/certs',
      }),
    } as Response);

    const { getAuthorizeUrl } = await import('@/lib/auth/sso/oidc');
    const url = await getAuthorizeUrl({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'secret',
      },
      redirectUri: 'https://app.example.com/callback',
      state: 'state-abc',
      nonce: 'nonce-xyz',
      scope: 'openid email',
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://idp.example.com/oauth/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback');
    expect(parsed.searchParams.get('scope')).toBe('openid email');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('nonce')).toBe('nonce-xyz');
    expect(parsed.searchParams.has('login_hint')).toBe(false);
  });

  it('includes login_hint when provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/auth',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/certs',
      }),
    } as Response);

    const { getAuthorizeUrl } = await import('@/lib/auth/sso/oidc');
    const url = await getAuthorizeUrl({
      provider: { issuer: 'https://idp.example.com', client_id: 'c', client_secret: 's' },
      redirectUri: 'https://app.example.com/cb',
      state: 's',
      nonce: 'n',
      loginHint: 'user@example.com',
    });

    expect(new URL(url).searchParams.get('login_hint')).toBe('user@example.com');
  });

  it('defaults scope to "openid email profile"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.example.com/auth',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/certs',
      }),
    } as Response);

    const { getAuthorizeUrl } = await import('@/lib/auth/sso/oidc');
    const url = await getAuthorizeUrl({
      provider: { issuer: 'https://idp.example.com', client_id: 'c', client_secret: 's' },
      redirectUri: 'https://app.example.com/cb',
      state: 's',
      nonce: 'n',
    });

    expect(new URL(url).searchParams.get('scope')).toBe('openid email profile');
  });

  it('uses inline endpoint overrides without calling discover', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { getAuthorizeUrl } = await import('@/lib/auth/sso/oidc');
    const url = await getAuthorizeUrl({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'c',
        client_secret: 's',
        authorization_endpoint: 'https://custom.example.com/auth',
        token_endpoint: 'https://custom.example.com/token',
        jwks_uri: 'https://custom.example.com/jwks',
      },
      redirectUri: 'https://app.example.com/cb',
      state: 's',
      nonce: 'n',
    });

    expect(url).toContain('https://custom.example.com/auth');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('exchangeAndVerify', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const validDiscovery = {
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/auth',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
  };

  it('exchanges code and verifies the ID token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validDiscovery,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'header.payload.sig', access_token: 'at' }),
      text: async () => JSON.stringify({ id_token: 'header.payload.sig', access_token: 'at' }),
    } as Response);

    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'user-1', email: 'user@example.com', nonce: 'expected-nonce' },
    });

    const { exchangeAndVerify } = await import('@/lib/auth/sso/oidc');
    const claims = await exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'auth-code-123',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'expected-nonce',
    });

    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('user@example.com');

    expect(mockJwtVerify).toHaveBeenCalledWith('header.payload.sig', 'mock-jwks', {
      issuer: validDiscovery.issuer,
      audience: 'client-123',
    });
  });

  it('caches JWKS and reuses it on subsequent calls for the same issuer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First call: discovery + token, second call: token only (discovery cached)
    // Order: discovery, token1, token2
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validDiscovery,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'tok1.sig' }),
      text: async () => JSON.stringify({ id_token: 'tok1.sig' }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'tok2.sig' }),
      text: async () => JSON.stringify({ id_token: 'tok2.sig' }),
    } as Response);

    mockJwtVerify.mockResolvedValueOnce({ payload: { nonce: 'n1', sub: 'u1' } });
    mockJwtVerify.mockResolvedValueOnce({ payload: { nonce: 'n2', sub: 'u2' } });

    const { exchangeAndVerify } = await import('@/lib/auth/sso/oidc');
    await exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'c1',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'n1',
    });
    await exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'c2',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'n2',
    });

    // createRemoteJWKSet should only be called once
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(new URL(validDiscovery.jwks_uri));
  });

  it('throws OidcError when token exchange fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validDiscovery,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    } as Response);

    const { exchangeAndVerify, OidcError } = await import('@/lib/auth/sso/oidc');
    const promise = exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'bad-code',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'n',
    });

    await expect(promise).rejects.toThrow(OidcError);
    await expect(promise).rejects.toMatchObject({ code: 'token_exchange_failed' });
  });

  it('throws OidcError when no id_token is returned', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validDiscovery,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'at-only' }),
      text: async () => JSON.stringify({ access_token: 'at-only' }),
    } as Response);

    const { exchangeAndVerify, OidcError } = await import('@/lib/auth/sso/oidc');
    const promise = exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'c',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'n',
    });

    await expect(promise).rejects.toThrow(OidcError);
    await expect(promise).rejects.toMatchObject({ code: 'no_id_token' });
  });

  it('throws OidcError when nonce in token does not match', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validDiscovery,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'h.p.s' }),
      text: async () => JSON.stringify({ id_token: 'h.p.s' }),
    } as Response);

    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'u1', nonce: 'wrong-nonce' },
    });

    const { exchangeAndVerify, OidcError } = await import('@/lib/auth/sso/oidc');
    const promise = exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
      },
      code: 'c',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'expected-nonce',
    });

    await expect(promise).rejects.toThrow(OidcError);
    await expect(promise).rejects.toMatchObject({ code: 'nonce_mismatch' });
  });

  it('uses inline endpoint overrides instead of discovery', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: 'h.p.s' }),
      text: async () => JSON.stringify({ id_token: 'h.p.s' }),
    } as Response);

    mockJwtVerify.mockResolvedValue({ payload: { nonce: 'n', sub: 'u' } });

    const { exchangeAndVerify } = await import('@/lib/auth/sso/oidc');
    await exchangeAndVerify({
      provider: {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'top-secret',
        authorization_endpoint: 'https://direct.example.com/auth',
        token_endpoint: 'https://direct.example.com/token',
        jwks_uri: 'https://direct.example.com/jwks',
      },
      code: 'c',
      redirectUri: 'https://app.example.com/cb',
      expectedNonce: 'n',
    });

    // Only one fetch call — the token POST, no discovery
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://direct.example.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('loadProviderConfig', () => {
  it('decrypts client_secret_enc when ENCRYPTION_KEY is set', async () => {
    process.env.ENCRYPTION_KEY = 'aes-key-123';
    const decryptFn = vi.fn().mockReturnValue('decrypted-secret');

    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(
      {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret_enc: 'encrypted-value',
        email_domains: ['example.com'],
      },
      decryptFn,
    );

    expect(decryptFn).toHaveBeenCalledWith('encrypted-value', 'aes-key-123');
    expect(result.client_secret).toBe('decrypted-secret');
    expect(result.issuer).toBe('https://idp.example.com');
    expect(result.client_id).toBe('client-123');
    expect(result.email_domains).toEqual(['example.com']);
  });

  it('falls back to plaintext client_secret when no encrypted secret', async () => {
    const decryptFn = vi.fn();
    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(
      {
        issuer: 'https://idp.example.com',
        client_id: 'client-123',
        client_secret: 'plain-secret',
      },
      decryptFn,
    );

    expect(decryptFn).not.toHaveBeenCalled();
    expect(result.client_secret).toBe('plain-secret');
  });

  it('throws OidcError when ENCRYPTION_KEY is missing and client_secret_enc is present', async () => {
    delete process.env.ENCRYPTION_KEY;
    const decryptFn = vi.fn();

    const { loadProviderConfig, OidcError } = await import('@/lib/auth/sso/oidc');
    expect(() =>
      loadProviderConfig(
        { issuer: 'https://idp.example.com', client_id: 'c', client_secret_enc: 'encrypted-value' },
        decryptFn,
      ),
    ).toThrow(OidcError);
    expect(() =>
      loadProviderConfig(
        { issuer: 'https://idp.example.com', client_id: 'c', client_secret_enc: 'encrypted-value' },
        decryptFn,
      ),
    ).toThrow(/ENCRYPTION_KEY is not configured/);
  });

  it('throws OidcError when decryptFn throws', async () => {
    process.env.ENCRYPTION_KEY = 'key';
    const decryptFn = vi.fn().mockImplementation(() => {
      throw new Error('bad decrypt');
    });

    const { loadProviderConfig, OidcError } = await import('@/lib/auth/sso/oidc');
    expect(() =>
      loadProviderConfig(
        { issuer: 'https://idp.example.com', client_id: 'c', client_secret_enc: 'enc' },
        decryptFn,
      ),
    ).toThrow(OidcError);
    expect(() =>
      loadProviderConfig(
        { issuer: 'https://idp.example.com', client_id: 'c', client_secret_enc: 'enc' },
        decryptFn,
      ),
    ).toThrow(/Failed to decrypt/);
  });

  it('uses empty string for client_secret when no secret is provided', async () => {
    const decryptFn = vi.fn();
    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(
      { issuer: 'https://idp.example.com', client_id: 'c' },
      decryptFn,
    );
    expect(result.client_secret).toBe('');
  });

  it('coerces issuer and client_id to strings', async () => {
    const decryptFn = vi.fn();
    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(
      { issuer: 123 as unknown as string, client_id: true as unknown as string },
      decryptFn,
    );
    expect(result.issuer).toBe('123');
    expect(result.client_id).toBe('true');
  });

  it('handles null/undefined raw config gracefully', async () => {
    const decryptFn = vi.fn();
    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(null, decryptFn);
    expect(result.issuer).toBe('');
    expect(result.client_id).toBe('');
    expect(result.client_secret).toBe('');
  });

  it('passes through optional endpoint overrides when present', async () => {
    const decryptFn = vi.fn();
    const { loadProviderConfig } = await import('@/lib/auth/sso/oidc');
    const result = loadProviderConfig(
      {
        issuer: 'https://idp.example.com',
        client_id: 'c',
        client_secret: 's',
        authorization_endpoint: 'https://idp.example.com/custom/auth',
        token_endpoint: 'https://idp.example.com/custom/token',
        jwks_uri: 'https://idp.example.com/custom/jwks',
      },
      decryptFn,
    );
    expect(result.authorization_endpoint).toBe('https://idp.example.com/custom/auth');
    expect(result.token_endpoint).toBe('https://idp.example.com/custom/token');
    expect(result.jwks_uri).toBe('https://idp.example.com/custom/jwks');
  });
});
