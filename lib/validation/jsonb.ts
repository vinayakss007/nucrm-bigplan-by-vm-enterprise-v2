/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * JSONB validation utilities.
 *
 * Provides app-level validation for JSONB columns (custom_fields, metadata)
 * as defense-in-depth alongside the DB CHECK constraints. Catches oversized
 * payloads before they hit the wire.
 */

/** Max serialized byte size for JSONB columns (64 KB). */
export const MAX_JSONB_BYTES = 65_536;

/** Max nesting depth for JSONB columns. */
export const MAX_JSONB_DEPTH = 10;

/** Max total key count across all nested objects. */
export const MAX_JSONB_KEYS = 200;

export interface JsonbValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a JSONB value for size, depth, and key count.
 * Returns { valid: true } or { valid: false, error: '...' }.
 */
export function validateJsonb(
  value: unknown,
  opts: {
    maxBytes?: number;
    maxDepth?: number;
    maxKeys?: number;
    label?: string;
  } = {}
): JsonbValidationResult {
  const { maxBytes = MAX_JSONB_BYTES, maxDepth = MAX_JSONB_DEPTH, maxKeys = MAX_JSONB_KEYS, label = 'JSONB' } = opts;

  if (value === null || value === undefined) return { valid: true };
  if (typeof value !== 'object') return { valid: false, error: `${label} must be an object or array` };

  // Size check (serialized)
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { valid: false, error: `${label} is not serializable` };
  }

  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) {
    return { valid: false, error: `${label} exceeds max size: ${bytes} bytes (max ${maxBytes})` };
  }

  // Depth check
  const depth = jsonDepth(value);
  if (depth > maxDepth) {
    return { valid: false, error: `${label} exceeds max depth: ${depth} (max ${maxDepth})` };
  }

  // Key count check
  const keys = jsonKeyCount(value);
  if (keys > maxKeys) {
    return { valid: false, error: `${label} exceeds max key count: ${keys} (max ${maxKeys})` };
  }

  return { valid: true };
}

/** Recursively compute max nesting depth. */
function jsonDepth(val: unknown): number {
  if (val === null || typeof val !== 'object') return 0;
  if (Array.isArray(val)) {
    let max = 0;
    for (const item of val) {
      const d = jsonDepth(item);
      if (d > max) max = d;
    }
    return 1 + max;
  }
  let max = 0;
  for (const v of Object.values(val as Record<string, unknown>)) {
    const d = jsonDepth(v);
    if (d > max) max = d;
  }
  return 1 + max;
}

/** Recursively count total keys across all objects. */
function jsonKeyCount(val: unknown): number {
  if (val === null || typeof val !== 'object') return 0;
  if (Array.isArray(val)) {
    let total = 0;
    for (const item of val) total += jsonKeyCount(item);
    return total;
  }
  const obj = val as Record<string, unknown>;
  let total = Object.keys(obj).length;
  for (const v of Object.values(obj)) total += jsonKeyCount(v);
  return total;
}
