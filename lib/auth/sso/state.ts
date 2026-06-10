/**
 * SSO state cookie — CSRF protection for the OIDC redirect flow.
 *
 * Before sending the user to the IdP we sign a short-lived state blob
 * containing the providerId, the random `state` parameter we'll receive
 * back, and the post-login URL. On the callback we verify the signature,
 * match the `state` query param, and discard the cookie.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export interface SsoStatePayload {
  providerId: string;
  tenantId: string;
  state: string;
  nonce: string;
  redirectTo?: string;
}

const COOKIE_NAME = 'nucrm_sso_state';
const TTL_SECONDS = 10 * 60; // 10 minutes — plenty for an IdP round-trip

function secret(): Uint8Array {
  const key = process.env['JWT_SECRET'];
  if (!key) {
    throw new Error('JWT_SECRET is not configured; cannot sign SSO state');
  }
  return new TextEncoder().encode(key);
}

/** Sign and write the state cookie. Call this just before redirecting to the IdP. */
export async function setSsoState(payload: SsoStatePayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax', // 'lax' so it survives the IdP redirect
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

/** Verify the state cookie and return its payload, or null if missing/invalid. */
export async function readSsoState(): Promise<SsoStatePayload | null> {
  const jar = await cookies();
  const cookieValue = jar.get(COOKIE_NAME)?.value;
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, secret());
    return {
      providerId: String(payload['providerId']),
      tenantId: String(payload['tenantId']),
      state: String(payload['state']),
      nonce: String(payload['nonce']),
      redirectTo: payload['redirectTo'] ? String(payload['redirectTo']) : undefined,
    };
  } catch (e) {
    console.error('[SSO] Failed to read SSO state cookie:', e);
    return null;
  }
}

/** Drop the state cookie — always call after successful or failed callback. */
export async function clearSsoState(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
