/**
 * Minimal OIDC client for SP-initiated SSO.
 *
 * Implements just enough of the OpenID Connect Core spec to support Google
 * Workspace, Okta, Azure AD, and any other RFC-compliant IdP without
 * pulling in `openid-client` (which has a heavy dep tree). Three steps:
 *
 *   1. discover(issuer)         — fetch /.well-known/openid-configuration
 *   2. getAuthorizeUrl(...)     — build the URL we redirect the user to
 *   3. exchangeAndVerify(...)   — POST /token, then verify the ID token
 *                                 signature against the IdP's JWKS
 *
 * Errors are normalised into `OidcError` so the caller can branch on a
 * stable code rather than parsing strings.
 */
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

export type OidcProviderConfig = {
  /** Identity provider issuer URL, e.g. "https://accounts.google.com". */
  issuer: string;
  client_id: string;
  client_secret: string;
  /** Optional override of authorization_endpoint when discovery is unavailable. */
  authorization_endpoint?: string;
  /** Optional override of token_endpoint. */
  token_endpoint?: string;
  /** Optional override of jwks_uri. */
  jwks_uri?: string;
  /** Email domains this provider is authoritative for (e.g. ["acme.com"]). */
  email_domains?: string[];
};

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  hd?: string;
}

export class OidcError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'OidcError';
    this.code = code;
    this.details = details;
  }
}

const DISCOVERY_CACHE = new Map<string, { at: number; doc: OidcDiscovery }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h
const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Fetch and cache /.well-known/openid-configuration. */
export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = DISCOVERY_CACHE.get(issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;

  const url = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new OidcError('discovery_failed', `Discovery for ${issuer} failed: ${res.status}`);
  }
  const doc = (await res.json()) as Partial<OidcDiscovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new OidcError('discovery_invalid', `Discovery doc for ${issuer} is missing required fields`);
  }
  const full: OidcDiscovery = {
    issuer: doc.issuer ?? issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
  };
  DISCOVERY_CACHE.set(issuer, { at: Date.now(), doc: full });
  return full;
}

/**
 * Resolve a config to concrete endpoints. Inline overrides win over discovery
 * so an admin can plug in an IdP that doesn't publish a discovery doc.
 */
async function resolveEndpoints(provider: OidcProviderConfig): Promise<OidcDiscovery> {
  if (provider.authorization_endpoint && provider.token_endpoint && provider.jwks_uri) {
    return {
      issuer: provider.issuer,
      authorization_endpoint: provider.authorization_endpoint,
      token_endpoint: provider.token_endpoint,
      jwks_uri: provider.jwks_uri,
    };
  }
  return discover(provider.issuer);
}

/** Build the IdP authorization URL — caller redirects the browser to it. */
export async function getAuthorizeUrl(args: {
  provider: OidcProviderConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  scope?: string;
  loginHint?: string;
}): Promise<string> {
  const ep = await resolveEndpoints(args.provider);
  const u = new URL(ep.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', args.provider.client_id);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('scope', args.scope ?? 'openid email profile');
  u.searchParams.set('state', args.state);
  u.searchParams.set('nonce', args.nonce);
  if (args.loginHint) u.searchParams.set('login_hint', args.loginHint);
  return u.toString();
}

/**
 * Exchange the authorization code for tokens, verify the ID token signature
 * + claims, and return the verified claims.
 */
export async function exchangeAndVerify(args: {
  provider: OidcProviderConfig;
  code: string;
  redirectUri: string;
  expectedNonce: string;
}): Promise<OidcClaims> {
  const ep = await resolveEndpoints(args.provider);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.provider.client_id,
    client_secret: args.provider.client_secret,
  });
  const res = await fetch(ep.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OidcError('token_exchange_failed', `Token exchange failed: ${res.status}`, text);
  }
  const tokens = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) {
    throw new OidcError('no_id_token', 'IdP did not return an id_token');
  }

  // Cache JWKS per issuer; createRemoteJWKSet handles internal caching too.
  let jwks = JWKS_CACHE.get(args.provider.issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(ep.jwks_uri));
    JWKS_CACHE.set(args.provider.issuer, jwks);
  }

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ep.issuer,
    audience: args.provider.client_id,
  });

  if (payload['nonce'] !== args.expectedNonce) {
    throw new OidcError('nonce_mismatch', 'ID token nonce does not match the request nonce');
  }
  return payload as OidcClaims;
}

/**
 * Convenience: pull the email-domain claim list from a provider config.
 * Used by the start endpoint to look up a provider for a given email.
 */
export function domainsFor(provider: OidcProviderConfig): string[] {
  return Array.isArray(provider.email_domains)
    ? provider.email_domains.map((d) => d.toLowerCase().trim()).filter(Boolean)
    : [];
}

/** Cryptographically random URL-safe string for state/nonce. */
export function randomToken(bytes: number = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}
