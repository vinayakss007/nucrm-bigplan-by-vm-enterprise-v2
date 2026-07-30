/**
 * API Error Codes Registry
 *
 * Centralized, machine-readable error codes for the NuCRM API.
 * Every API error response includes a `code` field that clients can
 * switch on programmatically (instead of parsing error messages).
 *
 * Benefits:
 * - Clients handle errors programmatically (no string matching)
 * - Mobile apps can show localized messages per code
 * - Documentation auto-generated from this registry
 * - Errors are consistent across all endpoints
 *
 * Usage:
 * ```ts
 * import { apiErr, ErrorCode } from '@/lib/api/error-codes';
 *
 * if (!found) return apiErr(ErrorCode.RESOURCE_NOT_FOUND, { resource: 'Contact', id });
 * if (duplicate) return apiErr(ErrorCode.RESOURCE_ALREADY_EXISTS, { field: 'email', value: email });
 * ```
 *
 * Not to be confused with apiError() in lib/api-error.ts (used by ~328 files).
 * They do different jobs:
 * - apiError(err) is for *unexpected* failures in catch blocks. It logs, reports
 *   5xx to Sentry, and deliberately hides the real message in production.
 * - apiErr(code) is for *expected*, enumerable outcomes the client should branch
 *   on. It does not log and does not alert.
 * Reach for apiError() when something went wrong; apiErr() when the request was
 * simply refused.
 *
 * `details` is echoed to the client verbatim -- do not pass raw exception text,
 * internal identifiers, or anything else you would not put in a public response.
 */

import { NextResponse } from 'next/server';

/**
 * All NuCRM API error codes.
 * Format: CATEGORY_SPECIFIC_ERROR
 */
export const ErrorCode = {
  // ── Auth (1xxx) ──
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_INSUFFICIENT_SCOPE: 'AUTH_INSUFFICIENT_SCOPE',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  AUTH_MFA_REQUIRED: 'AUTH_MFA_REQUIRED',
  AUTH_MFA_INVALID: 'AUTH_MFA_INVALID',

  // ── Validation (2xxx) ──
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATION_BODY_EMPTY: 'VALIDATION_BODY_EMPTY',
  VALIDATION_BODY_TOO_LARGE: 'VALIDATION_BODY_TOO_LARGE',
  VALIDATION_INVALID_JSON: 'VALIDATION_INVALID_JSON',
  VALIDATION_INVALID_FIELD: 'VALIDATION_INVALID_FIELD',
  VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',

  // ── Resources (3xxx) ──
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_DELETED: 'RESOURCE_DELETED',
  RESOURCE_ARCHIVED: 'RESOURCE_ARCHIVED',
  RESOURCE_LOCKED: 'RESOURCE_LOCKED',

  // ── Rate Limiting (4xxx) ──
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // ── Concurrency (5xxx) ──
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
  OPTIMISTIC_LOCK_FAILED: 'OPTIMISTIC_LOCK_FAILED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // ── Tenant (6xxx) ──
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_LIMIT_REACHED: 'TENANT_LIMIT_REACHED',
  MODULE_NOT_ENABLED: 'MODULE_NOT_ENABLED',

  // ── Server (7xxx) ──
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DEPENDENCY_FAILED: 'DEPENDENCY_FAILED',
  TIMEOUT: 'TIMEOUT',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

interface ErrorMetadata {
  /** HTTP status code for this error */
  status: number;
  /** Human-readable message template */
  message: string;
}

/**
 * Error code metadata registry — maps codes to HTTP status + default messages.
 */
const ERROR_METADATA: Record<ErrorCodeType, ErrorMetadata> = {
  // Auth
  [ErrorCode.AUTH_REQUIRED]: { status: 401, message: 'Authentication required' },
  [ErrorCode.AUTH_TOKEN_EXPIRED]: { status: 401, message: 'Token has expired' },
  [ErrorCode.AUTH_TOKEN_INVALID]: { status: 401, message: 'Token is invalid' },
  [ErrorCode.AUTH_INSUFFICIENT_SCOPE]: { status: 403, message: 'Insufficient permissions' },
  [ErrorCode.AUTH_ACCOUNT_DISABLED]: { status: 403, message: 'Account is disabled' },
  [ErrorCode.AUTH_MFA_REQUIRED]: { status: 403, message: 'Multi-factor authentication required' },
  [ErrorCode.AUTH_MFA_INVALID]: { status: 401, message: 'Invalid MFA code' },

  // Validation
  [ErrorCode.VALIDATION_FAILED]: { status: 400, message: 'Validation failed' },
  [ErrorCode.VALIDATION_BODY_EMPTY]: { status: 400, message: 'Request body is empty' },
  [ErrorCode.VALIDATION_BODY_TOO_LARGE]: { status: 413, message: 'Request body too large' },
  [ErrorCode.VALIDATION_INVALID_JSON]: { status: 400, message: 'Malformed JSON' },
  [ErrorCode.VALIDATION_INVALID_FIELD]: { status: 400, message: 'Invalid field value' },
  [ErrorCode.VALIDATION_MISSING_FIELD]: { status: 400, message: 'Required field missing' },

  // Resources
  [ErrorCode.RESOURCE_NOT_FOUND]: { status: 404, message: 'Resource not found' },
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: { status: 409, message: 'Resource already exists' },
  [ErrorCode.RESOURCE_DELETED]: { status: 410, message: 'Resource has been deleted' },
  [ErrorCode.RESOURCE_ARCHIVED]: { status: 410, message: 'Resource has been archived' },
  [ErrorCode.RESOURCE_LOCKED]: { status: 423, message: 'Resource is locked' },

  // Rate limiting
  [ErrorCode.RATE_LIMIT_EXCEEDED]: { status: 429, message: 'Rate limit exceeded' },
  [ErrorCode.DUPLICATE_REQUEST]: { status: 409, message: 'Duplicate request detected' },
  [ErrorCode.QUOTA_EXCEEDED]: { status: 402, message: 'Usage quota exceeded' },

  // Concurrency
  [ErrorCode.CONCURRENCY_CONFLICT]: { status: 409, message: 'Concurrent modification conflict' },
  [ErrorCode.OPTIMISTIC_LOCK_FAILED]: { status: 409, message: 'Resource was modified by another request' },
  [ErrorCode.TRANSACTION_FAILED]: { status: 500, message: 'Transaction failed after retries' },

  // Tenant
  [ErrorCode.TENANT_NOT_FOUND]: { status: 404, message: 'Tenant not found' },
  [ErrorCode.TENANT_SUSPENDED]: { status: 403, message: 'Tenant account is suspended' },
  [ErrorCode.TENANT_LIMIT_REACHED]: { status: 402, message: 'Tenant resource limit reached' },
  [ErrorCode.MODULE_NOT_ENABLED]: { status: 403, message: 'This module is not enabled for your plan' },

  // Server
  [ErrorCode.INTERNAL_ERROR]: { status: 500, message: 'Internal server error' },
  [ErrorCode.SERVICE_UNAVAILABLE]: { status: 503, message: 'Service temporarily unavailable' },
  [ErrorCode.DEPENDENCY_FAILED]: { status: 502, message: 'Upstream dependency failed' },
  [ErrorCode.TIMEOUT]: { status: 504, message: 'Request timed out' },
};

/**
 * Create a standardized API error response.
 *
 * @param code - The error code from ErrorCode enum
 * @param details - Additional context (shown to client)
 * @param overrideMessage - Override the default message
 */
export function apiErr(
  code: ErrorCodeType,
  details?: Record<string, unknown>,
  overrideMessage?: string,
): NextResponse {
  // Fall back rather than throw on an unregistered code. Callers reach this from
  // catch blocks, and a TypeError here would turn a handled 404 into an unhandled
  // 500. Mirrors getErrorStatus()'s ?? 500.
  const meta = ERROR_METADATA[code] ?? { status: 500, message: 'Internal server error' };

  // details are spread flat onto the body, so they must be applied FIRST: a
  // caller passing { code: ... } or { error: ... } -- e.g. relaying a field named
  // "code" from an upstream API -- would otherwise overwrite the machine-readable
  // code with arbitrary data, defeating the point of the registry.
  const body: Record<string, unknown> = {};
  if (details && Object.keys(details).length > 0) {
    Object.assign(body, details);
  }
  body.error = overrideMessage || meta.message;
  body.code = code;

  return NextResponse.json(body, { status: meta.status });
}

/**
 * Get the HTTP status for an error code.
 */
export function getErrorStatus(code: ErrorCodeType): number {
  return ERROR_METADATA[code]?.status ?? 500;
}

/**
 * Get all registered error codes (for API documentation generation).
 */
export function getAllErrorCodes(): Array<{ code: string; status: number; message: string }> {
  return Object.entries(ERROR_METADATA).map(([code, meta]) => ({
    code,
    status: meta.status,
    message: meta.message,
  }));
}
