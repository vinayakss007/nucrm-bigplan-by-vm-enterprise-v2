import { db } from '@/drizzle/db';
import { ssoProviders, ssoSessions } from '@/drizzle/schema/infra';
import { users, sessions } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createToken, hashToken } from '@/lib/auth/session';

export interface SSOProviderConfig {
  id: string;
  tenantId: string;
  providerType: 'saml' | 'oidc' | 'oauth2';
  name: string;
  config: SAMLConfig | OIDCConfig | OAuth2Config;
  isActive: boolean;
}

export interface SAMLConfig {
  entityId: string;
  ssoUrl: string;
  certificate: string;
  signatureAlgorithm?: string;
  acsUrl: string;
  nameIdFormat?: string;
}

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  redirectUri: string;
  scopes?: string[];
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes?: string[];
}

export interface SSOSession {
  userId: string;
  tenantId: string;
  providerId: string;
  sessionId: string;
  idToken?: string;
  samlAssertion?: string;
  expiresAt: Date;
}

/**
 * Initiate SSO login. Returns a redirect URL to the identity provider.
 */
export async function initiateSSO(
  tenantId: string,
  providerId: string
): Promise<{ redirectUrl: string; state: string }> {
  const results = await db.select()
    .from(ssoProviders)
    .where(and(
      eq(ssoProviders.id, providerId),
      eq(ssoProviders.tenantId, tenantId),
      eq(ssoProviders.isActive, true)
    ));

  const provider = results[0];
  if (!provider) {
    throw new Error('SSO provider not found or inactive');
  }

  const state = randomUUID();
  const config = provider.config as Record<string, unknown>;

  if (provider.providerType === 'saml') {
    const samlConfig = config as unknown as SAMLConfig;
    // Generate SAML AuthnRequest redirect URL
    const samlRequest = buildSAMLAuthnRequest(samlConfig.entityId, samlConfig.acsUrl);
    const encoded = Buffer.from(samlRequest).toString('base64');
    const redirectUrl = `${samlConfig.ssoUrl}?SAMLRequest=${encodeURIComponent(encoded)}&RelayState=${encodeURIComponent(state)}`;
    return { redirectUrl, state };
  }

  if (provider.providerType === 'oidc') {
    const oidcConfig = config as unknown as OIDCConfig;
    const scopes = oidcConfig.scopes?.join(' ') || 'openid profile email';
    const redirectUrl = `${oidcConfig.authorizationEndpoint}?` +
      `client_id=${encodeURIComponent(oidcConfig.clientId)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(oidcConfig.redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&nonce=${encodeURIComponent(randomUUID())}`;
    return { redirectUrl, state };
  }

  // OAuth2 fallback
  const oauth2Config = config as unknown as OAuth2Config;
  const scopes = oauth2Config.scopes?.join(' ') || 'read';
  const redirectUrl = `${oauth2Config.authorizationEndpoint}?` +
    `client_id=${encodeURIComponent(oauth2Config.clientId)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(oauth2Config.redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;
  return { redirectUrl, state };
}

/**
 * Handle SSO callback: validate the response and create/find user + session.
 * Issues a JWT session token so the user is authenticated for subsequent requests.
 */
export async function handleSSOCallback(
  tenantId: string,
  providerId: string,
  params: { code?: string; SAMLResponse?: string; state?: string },
  options?: { expectedState?: string }
): Promise<{ userId: string; sessionId: string; email: string; token: string }> {
  // Validate state parameter to prevent CSRF attacks
  if (options?.expectedState && params.state !== options.expectedState) {
    throw new Error('Invalid SSO state parameter. Possible CSRF attack.');
  }
  const results = await db.select()
    .from(ssoProviders)
    .where(and(
      eq(ssoProviders.id, providerId),
      eq(ssoProviders.tenantId, tenantId),
      eq(ssoProviders.isActive, true)
    ));

  const provider = results[0];
  if (!provider) {
    throw new Error('SSO provider not found or inactive');
  }

  const config = provider.config as Record<string, unknown>;
  let email: string;
  let idToken: string | undefined;
  let samlAssertion: string | undefined;

  if (provider.providerType === 'saml' && params.SAMLResponse) {
    // WARNING: This is a simplified SAML implementation that does NOT verify
    // the XML signature against the IdP certificate. Production deployments
    // MUST use a proper SAML library (e.g., saml2-js, passport-saml, or node-saml)
    // to validate signatures, assertion conditions (NotBefore, NotOnOrAfter),
    // audience restrictions, and replay protection. Without signature verification,
    // an attacker could forge arbitrary SAML assertions.
    samlAssertion = params.SAMLResponse;
    const decoded = Buffer.from(params.SAMLResponse, 'base64').toString('utf-8');
    const emailMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
    email = emailMatch?.[1] || '';
    if (!email) {
      throw new Error('Could not extract email from SAML assertion');
    }
  } else if (params.code) {
    // OIDC/OAuth2: exchange code for token
    const oidcConfig = config as unknown as OIDCConfig;
    const tokenResponse = await fetch(oidcConfig.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: oidcConfig.redirectUri,
        client_id: oidcConfig.clientId,
        client_secret: oidcConfig.clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange authorization code');
    }

    const tokenData = await tokenResponse.json() as { id_token?: string; access_token?: string };
    idToken = tokenData.id_token;

    if (idToken) {
      // Decode JWT payload (without full verification for user info extraction)
      const parts = idToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64').toString());
      email = payload.email as string;
    } else {
      // Fall back to userinfo endpoint
      const userinfoResponse = await fetch(oidcConfig.userinfoEndpoint, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userinfo = await userinfoResponse.json() as { email: string };
      email = userinfo.email;
    }

    if (!email) {
      throw new Error('Could not extract email from SSO response');
    }
  } else {
    throw new Error('Invalid SSO callback parameters');
  }

  // Find or create user by email
  const existingUsers = await db.select()
    .from(users)
    .where(eq(users.email, email));

  let userId: string;
  if (existingUsers[0]) {
    userId = existingUsers[0].id;
  } else {
    const [newUser] = await db.insert(users).values({
      email,
      emailVerified: true,
    }).returning();
    userId = newUser!.id;
  }

  // Create SSO session
  const sessionId = randomUUID();
  const session = await createSSOSession(userId, tenantId, providerId, {
    sessionId,
    idToken,
    samlAssertion,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });

  // Issue a JWT session token (same as standard login flow)
  const token = await createToken(userId);
  const tokenHash = await hashToken(token);
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  return { userId, sessionId: session.sessionId, email, token };
}

/**
 * Generate SAML SP metadata XML for a provider
 */
export function generateSAMLMetadata(
  tenantId: string,
  providerId: string,
  config: SAMLConfig
): string {
  const acsUrl = config.acsUrl;
  const entityId = config.entityId;

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${escapeXml(entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${escapeXml(acsUrl)}"
      index="1" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

/**
 * Validate an OIDC ID token (JWT).
 * Checks issuer, audience, and expiry. Does NOT validate cryptographic signature
 * (production should use JWKS verification).
 */
export function validateOIDCToken(
  idToken: string,
  config: OIDCConfig
): { valid: boolean; payload?: Record<string, unknown>; error?: string } {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64').toString()) as Record<string, unknown>;

    // Check issuer
    if (payload['iss'] !== config.issuer) {
      return { valid: false, error: `Invalid issuer: expected ${config.issuer}, got ${String(payload['iss'])}` };
    }

    // Check audience
    const aud = payload['aud'];
    if (Array.isArray(aud)) {
      if (!aud.includes(config.clientId)) {
        return { valid: false, error: 'Token audience mismatch' };
      }
    } else if (aud !== config.clientId) {
      return { valid: false, error: 'Token audience mismatch' };
    }

    // Check expiry
    const exp = payload['exp'] as number | undefined;
    if (!exp || exp * 1000 < Date.now()) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch {
    console.error('[sso] Failed to parse token');
    return { valid: false, error: 'Failed to parse token' };
  }
}

/**
 * Store an SSO session
 */
export async function createSSOSession(
  userId: string,
  tenantId: string,
  providerId: string,
  sessionData: {
    sessionId: string;
    idToken?: string;
    samlAssertion?: string;
    expiresAt: Date;
  }
) {
  const [session] = await db.insert(ssoSessions).values({
    userId,
    tenantId,
    providerId,
    sessionId: sessionData.sessionId,
    idToken: sessionData.idToken || null,
    samlAssertion: sessionData.samlAssertion || null,
    expiresAt: sessionData.expiresAt,
  }).returning();

  return session!;
}

// Helper: Build SAML AuthnRequest XML
function buildSAMLAuthnRequest(entityId: string, acsUrl: string): string {
  const id = `_${randomUUID()}`;
  const issueInstant = new Date().toISOString();

  return `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${id}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  AssertionConsumerServiceURL="${escapeXml(acsUrl)}">
  <saml:Issuer>${escapeXml(entityId)}</saml:Issuer>
</samlp:AuthnRequest>`;
}

// Helper: Escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
