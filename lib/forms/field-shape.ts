/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2287 — Single source of truth for reading form field definitions.
 *
 * The `forms.fields` JSON column has been persisted in two shapes:
 *
 *  - legacy / builder shape:  `{ key, label, type, required }`
 *  - current API shape (`createFormSchema` in `lib/api/schemas.ts`):
 *                             `{ id, label, type, required, options? }`
 *
 * `POST /api/forms/submit` (#1160) enforced required fields by reading
 * `f.key` only, so every form created through the API (which is forced to
 * key fields by `id`) silently bypassed the check. Rather than migrating the
 * stored shape (breaking for live forms + submitted data), every consumer
 * normalizes once through this helper and treats a field as addressable by
 * `key ?? id ?? name`.
 *
 * Keep this module dependency-free and client-safe: it is imported by API
 * routes, server pages and 'use client' components alike.
 */

/** A field definition exactly as it may appear inside the `forms.fields` JSON. */
export interface FormFieldLike {
  key?: unknown;
  id?: unknown;
  name?: unknown;
  label?: unknown;
  required?: unknown;
  type?: unknown;
}

/** A field definition after normalization: identity is guaranteed non-empty. */
export interface NormalizedFormField {
  /** The identifier submitted data is keyed by (`key`, else `id`, else `name`). */
  identity: string;
  /** Human-readable label; falls back to the identity when absent. */
  label: string;
  /** Whether the field must be present in a submission. */
  required: boolean;
}

/**
 * The identifier a submitted value is keyed by for this field. Prefers `key`
 * (legacy forms keep `key` AND an unrelated row-`id`, so `key` must win), then
 * `id` (current API shape), then `name`. Returns null when none is a usable
 * non-empty string, in which case the field cannot be enforced.
 */
export function getFieldIdentity(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as FormFieldLike;
  for (const candidate of [f.key, f.id, f.name]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

/** Required-ness of a raw field definition (strict `true`, matching #1160). */
export function isFieldRequired(field: unknown): boolean {
  return (
    !!field &&
    typeof field === 'object' &&
    (field as FormFieldLike).required === true
  );
}

/**
 * Normalize the (possibly malformed) `forms.fields` JSON into a clean list.
 * Non-array input yields []; entries without a usable identity are dropped.
 */
export function normalizeFormFields(fields: unknown): NormalizedFormField[] {
  if (!Array.isArray(fields)) return [];
  const out: NormalizedFormField[] = [];
  for (const raw of fields) {
    const identity = getFieldIdentity(raw);
    if (!identity) continue;
    const label = (raw as FormFieldLike).label;
    out.push({
      identity,
      label: typeof label === 'string' && label.trim().length > 0 ? label : identity,
      required: isFieldRequired(raw),
    });
  }
  return out;
}

/**
 * #1160 + #2287: given a form's field definitions (BOTH shapes) and the
 * submitted data, return the labels of required fields that are
 * missing/empty. Pure + shared by the public submit route and tests.
 */
export function findMissingRequiredFields(
  fields: unknown,
  formData: Record<string, unknown>
): string[] {
  return normalizeFormFields(fields)
    .filter((f) => f.required)
    .filter((f) => {
      const val = formData[f.identity];
      return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
    })
    .map((f) => f.label);
}
