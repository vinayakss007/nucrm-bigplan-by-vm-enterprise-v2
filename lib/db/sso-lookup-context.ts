/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The two pre-auth SSO claims (#3246 step 3), in their own module the way #2472 split
 * the portal lookup and #3163 split the form capture — `lib/db/rls.ts` is under the
 * #1843/#422 500-line ratchet.
 *
 * Both halves of `/api/auth/sso` are anonymous (`proxy.ts:216`) and both have to read
 * `sso_providers` before anyone is authenticated: `start` resolves the provider that
 * claims the caller's email domain, `callback` resolves the provider named by the
 * signed state cookie. `sso_providers` has one arm, `tenant_isolation`, keyed on
 * `app.current_tenant` — which both reset lists pin to '' — and `tenant_id` is NOT
 * NULL, so each read matched zero rows and SSO login was unreachable end to end.
 * Migration 0140 adds the two SELECT-only arms named here.
 *
 * The claims are the keys the route already had, not a flag that lets the query pick:
 * `app.sso_lookup_domain` narrows by domain value and `app.sso_provider_id` by primary
 * key, so neither arm admits a row the caller cannot already name. Both GUCs join BOTH
 * connection-reset lists (`lib/db/pool.ts`, `lib/db/request-connection.ts`), as #2446
 * requires of every privilege GUC.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls';
import { isUuid } from '@/lib/id';

/** The GUC 0140's domain arm keys off — a constant so both reset lists can name it. */
export const SSO_LOOKUP_DOMAIN_GUC = 'app.sso_lookup_domain';

/** The GUC 0140's primary-key arm keys off. */
export const SSO_PROVIDER_ID_GUC = 'app.sso_provider_id';

/** A claimed domain is a hostname: bounded, no whitespace, no local part. */
const DOMAIN_SHAPE = /^[^\s@]{1,253}$/;

/**
 * `start` derives this from the caller's email, so it is as unvalidated as the query
 * string. An empty value would be indistinguishable from an unset claim, which turns a
 * caller typo into a silent 404 rather than a loud bug at the call site.
 */
export function ssoLookupDomainValue(domain: string): string {
  const value = (domain ?? '').trim().toLowerCase();
  if (!DOMAIN_SHAPE.test(value)) {
    throw new Error(`[RLS] SSO domain claim "${value.slice(0, 60)}" is not a hostname — refusing to open a context that can name no row`);
  }
  return value;
}

/**
 * `sso_providers.id` is a uuid column and 0140 casts this value to `uuid`, so an
 * unvalidated string from the state cookie would be a `22P02` on a public endpoint.
 */
export function ssoProviderIdValue(providerId: string): string {
  const value = (providerId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] SSO provider claim called with an empty providerId — refusing to open a context that can name no row');
  }
  if (!isUuid(value)) {
    throw new Error(`[RLS] SSO provider claim providerId "${value.slice(0, 40)}" is not a uuid — 0140's clause casts it, so this would be a 22P02 on a public endpoint`);
  }
  return value;
}

/** Transaction-local by construction: a claim that outlived its read is the leak #2446 is about. */
export async function setSsoDomainLookupContext(tx: RlsTransaction, domain: string): Promise<void> {
  const value = ssoLookupDomainValue(domain);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${SSO_LOOKUP_DOMAIN_GUC}, ${value}, true)`);
}

/** Transaction-local by construction, for the same reason. */
export async function setSsoProviderLookupContext(tx: RlsTransaction, providerId: string): Promise<void> {
  const value = ssoProviderIdValue(providerId);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${SSO_PROVIDER_ID_GUC}, ${value}, true)`);
}

/**
 * Run `fn` in one transaction carrying 0140's domain claim. Keep the callback to the
 * lookup: the discovery fetch and the state cookie belong outside it, so a slow IdP
 * never holds a pooled connection on a route no session is needed to reach.
 */
export async function withSsoDomainLookupContext<T>(
  domain: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = ssoLookupDomainValue(domain);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setSsoDomainLookupContext(tx, value);
    return fn(tx);
  });
}

/** Run `fn` in one transaction carrying 0140's primary-key claim on exactly one provider row. */
export async function withSsoProviderLookupContext<T>(
  providerId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = ssoProviderIdValue(providerId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setSsoProviderLookupContext(tx, value);
    return fn(tx);
  });
}
