/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

/**
 * Issue #2286 — lenient UUID validator for entity-ID reference fields.
 *
 * Zod v4's `z.string().uuid()` implements RFC 9562 strictly: it requires a
 * legal version nibble (first hex digit of group 3 ∈ {1..8}) AND variant
 * nibble (first hex digit of group 4 ∈ {8,9,a,b}). The app's own seeded IDs
 * — pipeline stages `50000000-0000-0000-0000-000000000001`, companies
 * `60000000-…`, pipelines `40000000-…` — have version/variant nibbles of `0`
 * (only the all-zero nil UUID is special-cased by Zod), so clients that read
 * such an ID from a GET endpoint and echo it back on a POST/PATCH body were
 * rejected with 400 "Invalid UUID" — a read/write asymmetry.
 *
 * `z.guid()` is Zod v4's built-in version-agnostic shape check:
 * `/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/`
 * — exactly what the Postgres `uuid` column accepts. Referential integrity is
 * enforced by the FKs, so RFC version/variant strictness adds nothing but
 * false rejections on write paths.
 *
 * The error message is kept identical to the old `z.string().uuid()`
 * ("Invalid UUID") so the shape of 400 "Validation failed" details is
 * unchanged for existing API consumers.
 */
export const uuidIdSchema = z.string().guid({ error: 'Invalid UUID' });

/**
 * Same lenient shape check as {@link uuidIdSchema} but with a custom error
 * message, for the handful of routes whose 400 details historically carried
 * field-specific wording (e.g. "tenant_id is required"). Keeping the config in
 * one module means "lenient entity UUID" has exactly one definition (#2286).
 */
export function uuidIdSchemaWith(message: string) {
  return z.string().guid({ error: message });
}
