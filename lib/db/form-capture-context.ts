/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The anonymous form-capture lookup context (#3163).
 *
 * `/api/forms/submit` and `/api/tenant/forms/public/[id]` must learn which
 * workspace a form belongs to before they can scope anything to it — and that
 * resolution is itself a read of `forms`, whose only tenant policy compares
 * `tenant_id` to `app.current_tenant`, a value the request does not have yet
 * because finding it is the point of the query. Under the fail-closed deparse
 * that is a silent zero-row read, which is why the public render 404s and the
 * public submit reports "Form not found or inactive" for a form that is
 * published, active and owned (#3163 measured both).
 *
 * Same shape as #2446's `lib/db/portal-lookup-context.ts`, for the same reasons:
 * one GUC naming the single row the caller is allowed to read, a SELECT-only
 * policy behind it (migration `0132_public_form_capture_lookup.sql`), the value
 * transaction-local inside this scope, and the GUC listed in the reset on every
 * pooled checkout (`lib/db/pool.ts`, `lib/db/request-connection.ts`) — a
 * privilege GUC that survives a checkout is handed to an unrelated request
 * under PgBouncer.
 *
 * The tenant-scoped work that FOLLOWS still runs in `withTenantContext()`: this
 * context is SELECT-only and knows no tenant, so it cannot write a submission
 * or read a contact.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls';
import { isUuid } from '@/lib/id';

/** The GUC migration 0132's capture policy keys off. Named as a constant so the
 *  reset on pooled checkout can list the same string. */
export const FORM_LOOKUP_ID_GUC = 'app.form_lookup_id';

/** `forms.id` is a `uuid` column, so only the two spellings Postgres itself
 *  casts are worth accepting here: the canonical hyphenated form (what
 *  `gen_random_uuid()` and every insert in this app produce) and the bare
 *  32-hex form. A structured id (`ACME-FM-…`) cannot be stored in this column. */
const UNHYPHENATED_UUID = /^[0-9a-f]{32}$/i;

/**
 * Validate the id a capture lookup is being resolved by, or throw.
 *
 * 0132's clause casts this value to `uuid`, so a caller that passed an
 * unvalidated string would make Postgres abort with `22P02 invalid input syntax
 * for type uuid` — the exact 500-class #2288 removed from this endpoint's body
 * handling. Callers still answer their own 400; this is the backstop that keeps
 * a future caller from turning a public endpoint into a Postgres error.
 */
export function formLookupValue(formId: string): string {
  const value = (formId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] form lookup called with an empty formId — refusing to open a public read on nothing');
  }
  if (!isUuid(value) && !UNHYPHENATED_UUID.test(value)) {
    throw new Error(`[RLS] form lookup formId "${value.slice(0, 40)}" is not a uuid — 0132's clause casts it, so this would be a 22P02 on a public endpoint`);
  }
  return value;
}

function formLookupStatement(value: string, isLocal: ReturnType<typeof sql>): ReturnType<typeof sql> {
  return sql`SELECT set_config(${FORM_LOOKUP_ID_GUC}, ${value}, ${isLocal})`;
}

/**
 * Mark the transaction (or, with no `tx`, the current checkout) as resolving one
 * public form by id.
 */
export async function setFormLookupContext(formId: string, tx?: RlsTransaction): Promise<void> {
  const value = formLookupValue(formId);
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(formLookupStatement(value, isLocal));
}

/**
 * Read one published form's definition on behalf of an anonymous caller.
 *
 * Keep `fn` to the lookup itself, the way `withPortalLookupContext` says: the
 * privilege is real, and the policy already restricts it to one active,
 * non-trashed row, so a broadened callback would just be a query that happens
 * to run under a public read context. Everything tenant-scoped that follows goes
 * through `withTenantContext(form.tenantId, NO_USER_SENTINEL, …)`.
 */
export async function withFormLookupContext<T>(
  formId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = formLookupValue(formId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await tx.execute(formLookupStatement(value, sql`true`));
    return fn(tx);
  });
}
