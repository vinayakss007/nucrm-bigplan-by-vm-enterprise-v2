/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3750 — the contact picker options used by invoices/contracts/quotes/orders.
 *
 * `GET /api/tenant/contacts` answers `{ data: [...], total, offset, limit }`
 * with SNAKE_CASE columns. Those pages used to read `contacts` and camelCase
 * names — a shape the endpoint never sends — so every picker and Contact
 * column was empty. One normalizer here keeps all four consumers honest.
 */

export interface ContactOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

/** The exact subset of the contacts list response the pickers need. */
export interface ContactListRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  // Tolerate an already-normalized row (tests, cached data) without loss.
  firstName?: string | null;
  lastName?: string | null;
}

export function normalizeContactOptions(rows: ContactListRow[] | undefined): ContactOption[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name ?? row.firstName ?? '',
    lastName: row.last_name ?? row.lastName ?? '',
    email: row.email ?? null,
  }));
}

/** Read the contacts list envelope defensively — missing data is an empty list. */
export function contactOptionsFromEnvelope(
  envelope: { data?: ContactListRow[] } | undefined,
): ContactOption[] {
  return normalizeContactOptions(envelope?.data);
}
