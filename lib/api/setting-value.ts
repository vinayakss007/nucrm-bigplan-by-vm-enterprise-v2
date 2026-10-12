/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Reading a `platform_settings.value`.
 *
 * That column is `jsonb`, and the pg driver hands back the *decoded* JS value.
 * Routes used to do `JSON.parse(String(row.value))`, which only works when the
 * column happens to contain a JSON text. For an array it stringifies to
 * `203.0.113.9` (Array.prototype.join) and JSON.parse throws at position 5, so
 * the settings page 500s on every read of a value that was saved correctly.
 *
 * Values can legitimately arrive in two shapes: the decoded jsonb (the normal
 * case) and, for rows written before that was understood, a JSON document
 * parked in a jsonb string. Both are handled here; anything else falls back
 * rather than throwing at the caller.
 */

/**
 * @param raw      the value as read from the column
 * @param fallback returned when the row is absent or the value is unusable
 * @param kind     shape the caller expects, so a wrong-typed row degrades to
 *                 the fallback instead of becoming a runtime TypeError later
 */
export function decodeSettingValue<T>(raw: unknown, fallback: T, kind: 'array' | 'object'): T {
  let value: unknown = raw;

  if (value === null || value === undefined || value === '') return fallback;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  if (kind === 'array') return Array.isArray(value) ? (value as T) : fallback;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : fallback;
}
