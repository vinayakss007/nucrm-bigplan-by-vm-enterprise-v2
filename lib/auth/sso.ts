/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { ssoProviders, ssoSessions } from '@/drizzle/schema/infra';
import { users, sessions } from '@/drizzle/schema/core';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createToken, hashToken } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

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
    // Verify SAML assertion signature against IdP certificate.
    samlAssertion = params.SAMLResponse;
    const decoded = Buffer.from(params.SAMLResponse, 'base64').toString('utf-8');

    const samlConfig = config as unknown as SAMLConfig;
    if (!samlConfig.certificate) {
      throw new Error('SAML provider missing certificate configuration');
    }

    // Verify signature AND read the identity from the validated profile.
    const profile = await verifySAMLAndGetProfile(decoded, samlConfig);
    if (!profile) {
      throw new Error('SAML assertion signature verification failed');
    }

    // SECURITY (XSW): take the email from the cryptographically-validated
    // profile, NOT from a regex over the raw XML. node-saml resolves NameID
    // from the signed assertion node.
    const emailFromProfile =
      (typeof profile.email === 'string' && profile.email) ||
      (typeof profile.nameID === 'string' && /@/.test(profile.nameID) ? profile.nameID : '') ||
      (typeof (profile.attributes as Record<string, unknown> | undefined)?.['email'] === 'string'
        ? String((profile.attributes as Record<string, unknown>)['email'])
        : '');
    email = String(emailFromProfile || '');
    if (!email) {
      throw new Error('Could not extract email from validated SAML assertion');
    }
  } else if (params.code) {
    // OIDC/OAuth2: exchange code for token with proper JWT verification
    const oidcConfig = config as unknown as OIDCConfig;
    
    // Use the newer OIDC module for proper JWT signature verification
    const { exchangeAndVerify, OidcError } = await import('@/lib/auth/sso/oidc');
    
    try {
      // Convert config to OidcProviderConfig format
      const providerConfig = {
        issuer: oidcConfig.issuer,
        client_id: oidcConfig.clientId,
        client_secret: oidcConfig.clientSecret,
        authorization_endpoint: oidcConfig.authorizationEndpoint,
        token_endpoint: oidcConfig.tokenEndpoint,
        jwks_uri: undefined, // Will be discovered from issuer
      };
      
      // Generate a random nonce for this request
      const nonce = randomUUID();
      
      // Exchange code and verify JWT signature against JWKS
      const claims = await exchangeAndVerify({
        provider: providerConfig,
        code: params.code,
        redirectUri: oidcConfig.redirectUri,
        expectedNonce: nonce,
      });
      
      email = claims.email ?? '';
      idToken = undefined; // ID token is verified, don't need to store raw
    } catch (error) {
      if (error instanceof OidcError) {
        throw new Error(`OIDC verification failed: ${error.message}`);
      }
      throw error;
    }

    if (!email) {
      throw new Error('Could not extract email from SSO response');
    }
  } else {
    throw new Error('Invalid SSO callback parameters');
  }

  // SECURITY: enforce the provider's email-domain allowlist before matching a
  // local account. Without this, any email an assertion returns could claim an
  // existing account (account takeover). Mirrors the modern OIDC callback.
  const normalizedEmail = email.toLowerCase().trim();
  const allowedDomains = Array.isArray((config as { email_domains?: unknown }).email_domains)
    ? ((config as { email_domains: unknown[] }).email_domains as string[])
    : [];
  if (allowedDomains.length > 0) {
    const domain = normalizedEmail.split('@')[1] || '';
    if (!allowedDomains.map((d) => String(d).toLowerCase()).includes(domain)) {
      throw new Error('Email domain is not authorised for this workspace');
    }
  }
  email = normalizedEmail;

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

  // Create SSO session + JWT token atomically
  const sessionId = randomUUID();
  const token = await createToken(userId);
  const tokenHash = await hashToken(token);

  await db.transaction(async (tx) => {
    const [session] = await tx.insert(ssoSessions).values({
      userId,
      tenantId,
      providerId,
      sessionId,
      idToken: idToken || null,
      samlAssertion: samlAssertion || null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning();

    if (!session) throw new Error('Failed to create SSO session');

    await tx.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  return { userId, sessionId, email, token };
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
 * Uses proper JWT signature verification via JWKS.
 * Rejects tokens when JWKS verification cannot be performed.
 */
export async function validateOIDCToken(
  idToken: string,
  config: OIDCConfig
): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const payload = JSON.parse(Buffer.from(parts[1] || '', 'base64').toString()) as Record<string, unknown>;

    // Verify signature using JWKS — required for OIDC security
    if (!config.issuer) {
      return { valid: false, error: 'OIDC issuer not configured — cannot verify token signature' };
    }

    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    const JWKS = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/openid-configuration`));
    
    await jwtVerify(idToken, JWKS, {
      issuer: config.issuer,
      audience: config.clientId,
    });
    
    return { valid: true, payload };
  } catch (verifyError) {
    logger.error('[SSO] OIDC token verification failed', { error: verifyError instanceof Error ? verifyError.message : String(verifyError) });
    return { valid: false, error: 'Token signature verification failed' };
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

/** The subset of the validated SAML profile we consume. */
export interface VerifiedSamlProfile {
  nameID?: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Verify a SAML response's XML signature against the IdP certificate and
 * return the CRYPTOGRAPHICALLY-VALIDATED profile (or null on failure).
 *
 * SECURITY (XSW): the caller must read the identity (NameID/email) from the
 * returned profile — NEVER from a regex over the raw XML. Reading NameID off
 * the raw document is a classic XML Signature Wrapping bypass: an attacker
 * wraps a forged assertion so the text-level regex sees an attacker-controlled
 * NameID while the signature validates a different, legitimate node.
 *
 * The validator is now built with the provider's actual IdP certificate and
 * issuer as the trust anchor (previously it was constructed with empty
 * `issuer`/`idpIssuer` and never received the cert, so there was no anchor to
 * verify against).
 */
async function verifySAMLAndGetProfile(
  samlXml: string,
  cfg: SAMLConfig,
): Promise<VerifiedSamlProfile | null> {
  if (!cfg.certificate) {
    logger.error('[SAML] Missing IdP certificate — cannot verify signature');
    return null;
  }
  try {
    const SAMLModule = await import('@node-saml/node-saml');
    const SAMLClass = (SAMLModule as unknown as {
      SAML: new (opts: Record<string, unknown>) => {
        validatePostResponseAsync: (container: { SAMLResponse: string }) => Promise<{ profile?: VerifiedSamlProfile | null }>;
      };
    }).SAML;

    const samlValidator = new SAMLClass({
      // Trust anchor: the IdP's signing certificate. Without this the library
      // has nothing to verify the signature against.
      idpCert: cfg.certificate,
      // Our SP identity / expected audience, so a response minted for another
      // audience is rejected.
      issuer: cfg.entityId,
      callbackUrl: cfg.acsUrl,
      audience: cfg.entityId,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      acceptedClockSkewMs: 5000,
      maxAssertionAgeMs: 300000,
      allowCreate: false,
      requestIdExpirationPeriodMs: 3600000,
      // Stateless legacy path: we don't persist AuthnRequest IDs, so don't
      // require InResponseTo correlation (CSRF is covered by the state cookie
      // in the route handler).
      validateInResponseTo: 'never',
      cacheProvider: {
        saveAsync: async () => null,
        getAsync: async () => null,
        removeAsync: async () => null,
      },
    });

    // node-saml expects the base64 SAMLResponse in a container object.
    const b64 = Buffer.from(samlXml, 'utf-8').toString('base64');
    const validateResult = await samlValidator.validatePostResponseAsync({ SAMLResponse: b64 });

    if (validateResult?.profile) {
      return validateResult.profile;
    }
    logger.error('[SAML] Validation failed: no profile returned');
    return null;
  } catch (error) {
    logger.error('[SAML] Signature verification error', { error: error instanceof Error ? error.message : String(error) });
    // Reject — do NOT fall back to structure-only checks which are trivially forgeable
    return null;
  }
}
