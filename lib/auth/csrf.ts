/**
 * CSRF Protection Module
 * 
 * Implements Double Submit Cookie pattern for CSRF protection
 */

// Use Web Crypto API for Edge Runtime compatibility
function getRandomValues(length: number): Uint8Array {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return array;
  }
  // Fallback for Node.js
  const { randomBytes } = require('crypto');
  return randomBytes(length);
}

function createHashSha256(data: string): string {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Web Crypto API (Edge Runtime)
    // Note: This is async, but for CSRF we can use a simpler sync approach
    // For Edge, we'll use a simple hash that works synchronously
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).padStart(10, '0');
  }
  // Node.js
  const { createHash } = require('crypto');
  return createHash('sha256').update(data).digest('hex');
}

const CSRF_COOKIE_NAME = 'nucrm_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  const bytes = getRandomValues(32);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a CSRF token for secure storage
 */
function hashToken(token: string): string {
  return createHashSha256(token);
}

/**
 * Set CSRF token in cookie
 */
export function setCsrfCookie(token: string, isProduction: boolean = false): string {
  const cookieOptions = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Strict',
    isProduction ? 'Secure' : null,
  ].filter(Boolean).join('; ');
  
  return cookieOptions;
}

/**
 * Extract CSRF token from cookie header
 */
export function getCsrfTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  
  const match = cookieHeader.match(/(?:^|;\s*)nucrm_csrf_token=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract CSRF token from request header
 */
export function getCsrfTokenFromHeader(headers: Headers, headerName: string = CSRF_HEADER_NAME): string | null {
  return headers.get(headerName) ?? null;
}

/**
 * Validate CSRF token using Double Submit Cookie pattern
 * 
 * This pattern works by:
 * 1. Setting a random token in a cookie (HttpOnly: false, so JS can read it)
 * 2. Client sends the token in a custom header (X-CSRF-Token)
 * 3. Server compares cookie token with header token
 * 
 * Since attacker cannot read the cookie (same-origin policy) or set custom headers,
 * they cannot forge a valid request.
 */
export function validateCsrfToken(
  cookieToken: string | null,
  headerToken: string | null
): boolean {
  if (!cookieToken || !headerToken) {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  const cookieHash = hashToken(cookieToken);
  const headerHash = hashToken(headerToken);
  
  if (cookieHash.length !== headerHash.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < cookieHash.length; i++) {
    result |= cookieHash.charCodeAt(i) ^ headerHash.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Middleware to validate CSRF token for state-changing requests
 * 
 * Safe methods (GET, HEAD, OPTIONS) are exempt from CSRF protection
 */
export function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Check if request needs CSRF validation
 * 
 * Exemptions:
 * - Safe HTTP methods (GET, HEAD, OPTIONS)
 * - API key authenticated requests (already secure)
 * - Webhook endpoints (use signature verification)
 */
export function needsCsrfValidation(method: string, path: string, authMethod?: string): boolean {
  if (isSafeMethod(method)) return false;
  if (authMethod === 'api_key') return false;
  if (path.startsWith('/api/webhooks/')) return false;
  if (path.startsWith('/api/cron/')) return false;
  if (path.startsWith('/api/auth/')) return false;
  if (path.startsWith('/api/v1/')) return false;
  if (path.startsWith('/api/forms/')) return false;
  if (path.startsWith('/api/leads/public/')) return false;
  
  return true;
}
