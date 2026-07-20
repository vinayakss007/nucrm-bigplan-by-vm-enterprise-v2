/**
 * Structured ID system for multi-tenant CRM.
 *
 * Format: `<ORG_CODE>-<ENTITY_CODE>-<BASE62_UUID>`
 * Example: `ACME-DL-4wr7jBDTEqVBCsXEih4zfP`
 *
 * Phase 1: Foundation — utilities only, no schema changes yet.
 * Old UUIDs remain valid; parseStructuredId() returns null for them.
 */

// ─── Constants ──────────────────────────────────────────────

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entity abbreviation codes — must be 2-3 uppercase chars, globally unique. */
export const ENTITY_CODES: Record<string, string> = {
  company: 'CO',
  contact: 'CT',
  deal: 'DL',
  lead: 'LD',
  task: 'TK',
  ticket: 'TI',
  invoice: 'IV',
  quote: 'QT',
  contract: 'CN',
  product: 'PR',
  activity: 'AC',
  note: 'NT',
  email: 'EM',
  form: 'FM',
  template: 'TP',
  campaign: 'CP',
  segment: 'SG',
  user: 'UR',
  plan: 'PL',
  module: 'MD',
  tenant: 'TN',
  payment: 'PY',
  subscription: 'SU',
  automation: 'AU',
  webhook: 'WH',
  file: 'FL',
  knowledge: 'KB',
  comment: 'CM',
  project: 'PJ',
  board: 'BD',
  column: 'CL',
  row: 'RW',
} as const;

export type EntityCode = keyof typeof ENTITY_CODES;

// Reverse map: code → name
const CODE_TO_ENTITY: Record<string, string> = {};
for (const [name, code] of Object.entries(ENTITY_CODES)) {
  CODE_TO_ENTITY[code] = name;
}

// ─── Base62 ↔ UUID ──────────────────────────────────────────

/** Decode a single base62 character to its numeric value (0-61). */
function charToValue(char: string): number {
  const idx = BASE62_CHARS.indexOf(char);
  if (idx === -1) throw new Error(`Invalid base62 character: ${char}`);
  return idx;
}

/** Encode a number to a single base62 character. */
function valueToChar(value: number): string {
  return BASE62_CHARS[value]!;
}

/**
 * Convert a UUID string to a 22-character base62 string.
 * Uses big-endian: UUID bytes → big integer → base62 digits.
 */
export function uuidToBase62(uuid: string): string {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }

  // Remove hyphens, parse as hex → BigInt
  const hex = uuid.replace(/-/g, '');
  const num = BigInt(`0x${hex}`);

  // Convert to base62, pad to 22 chars
  let result = '';
  let remaining = num;
  while (remaining > 0n) {
    const digit = Number(remaining % 62n);
    result = valueToChar(digit) + result;
    remaining = remaining / 62n;
  }

  return result.padStart(22, '0');
}

/**
 * Convert a 22-character base62 string back to a UUID.
 */
export function base62ToUuid(b62: string): string {
  if (b62.length !== 22) {
    throw new Error(`Invalid base62 string: expected 22 chars, got ${b62.length}`);
  }

  let num = 0n;
  for (const char of b62) {
    num = num * 62n + BigInt(charToValue(char));
  }

  const hex = num.toString(16).padStart(32, '0');

  // Insert hyphens: 8-4-4-4-12
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ─── Org code generation ────────────────────────────────────

/**
 * Generate a short org code from a tenant slug.
 *
 * Algorithm:
 * 1. Take first 4 chars of slug, uppercase
 * 2. If 4+ chars → use as-is (e.g., "acme" → "ACME")
 * 3. If <4 chars → pad with sequential digits (e.g., "ab" → "AB01")
 * 4. If collision with existing codes → append sequential numbers
 */
export function generateOrgCode(slug: string, existing?: Set<string>): string {
  if (!slug || slug.length === 0) {
    throw new Error('Slug cannot be empty');
  }

  const normalized = slug.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const base = normalized.slice(0, 4);

  // Pad if too short
  const candidate = base.length >= 4 ? base : base.padEnd(4, '0');

  if (!existing) return candidate;
  if (!existing.has(candidate)) return candidate;

  // Handle collisions — append sequential digits
  const suffixLen = 4 - base.length; // how many digits we can append
  if (suffixLen > 0) {
    for (let i = 1; i <= Math.pow(10, suffixLen) - 1; i++) {
      const suffix = String(i).padStart(suffixLen, '0');
      const attempt = base + suffix;
      if (!existing.has(attempt)) return attempt;
    }
  } else {
    // base is already 4 chars — append 2-digit suffix
    for (let i = 1; i <= 99; i++) {
      const suffix = String(i).padStart(2, '0');
      const attempt = candidate + suffix;
      if (!existing.has(attempt)) return attempt;
    }
  }

  throw new Error(`Could not generate unique org code for slug: ${slug}`);
}

// ─── Structured ID generation & parsing ─────────────────────

/**
 * Generate a structured ID in format: `ORG-ENTITY-<base62_uuid>`.
 *
 * @param orgCode - 4-char org code (e.g., "ACME")
 * @param entityCode - 2-3 char entity code (e.g., "DL" for deal)
 * @returns Structured ID string
 */
export function generateStructuredId(orgCode: string, entityCode: string): string {
  if (!orgCode || orgCode.length < 2) {
    throw new Error(`Invalid org code: ${orgCode}`);
  }
  if (!entityCode || entityCode.length < 2 || entityCode.length > 3) {
    throw new Error(`Invalid entity code: ${entityCode}`);
  }
  if (!CODE_TO_ENTITY[entityCode]) {
    throw new Error(`Unknown entity code: ${entityCode}. Valid codes: ${Object.keys(CODE_TO_ENTITY).join(', ')}`);
  }

  // Generate random UUID v4
  const uuid = crypto.randomUUID();
  const b62 = uuidToBase62(uuid);

  return `${orgCode.toUpperCase()}-${entityCode}-${b62}`;
}

/**
 * Parse a structured ID into its components.
 * Returns null for plain UUIDs or invalid formats.
 */
export function parseStructuredId(id: string): {
  orgCode: string;
  entityCode: string;
  entityName: string;
  uuid: string;
} | null {
  if (!id) return null;

  // Split into exactly 3 parts: ORG-ENTITY-B62
  const parts = id.split('-');
  if (parts.length < 3) return null;

  // The base62 part is the last 22 chars
  const b62Part = parts[parts.length - 1]!;
  if (b62Part.length !== 22) return null;

  // Entity code is the second-to-last part
  const entityCode = parts[parts.length - 2]!;
  if (!entityCode || entityCode.length < 2 || entityCode.length > 3) return null;

  // Validate entity code
  const entityName = CODE_TO_ENTITY[entityCode];
  if (!entityName) return null;

  // Org code is everything before entity and b62
  const orgCode = parts.slice(0, parts.length - 2).join('-');
  if (!orgCode || orgCode.length < 2) return null;

  // Validate base62 can be decoded to UUID
  try {
    const uuid = base62ToUuid(b62Part);
    return { orgCode, entityCode, entityName, uuid };
  } catch {
    return null;
  }
}

/**
 * Check if a string is a structured ID (vs a plain UUID).
 */
export function isStructuredId(id: string): boolean {
  return parseStructuredId(id) !== null;
}
