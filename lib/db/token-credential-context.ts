/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The pre-auth credential contexts (#3218), split out of `lib/db/rls.ts` the way
 * #2472 split the portal lookup context into `lib/db/portal-lookup-context.ts`:
 * `rls.ts` is under the #1843/#422 500-line ratchet, and this block is
 * self-contained — four GUC names (`app.auth_lookup`, `app.current_user`,
 * `app.token_issue`, `app.token_retire_user`, plus `app.token_credential` which
 * names the bearer value the query is matching), the claim rules that fill them,
 * and the single statement that sets them each time (#87/PP-028).
 *
 * `lib/db/rls.ts` re-exports everything here, so call sites and test mocks keep
 * importing them from `@/lib/db/rls`. The primitives it needs come from
 * `lib/db/rls-client.ts` rather than from `rls.ts` itself, because that edge
 * would run the other way and make a cycle.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, type RlsTransaction } from '@/lib/db/rls-client';

/**
 * Mark the transaction as performing a pre-auth credential lookup.
 *
 * `users` has no SELECT policy that an unauthenticated connection can satisfy
 * (read_self needs app.current_user; super_admin_read needs the security
 * context), so `handleLogin`'s `SELECT ... WHERE email = ?` matched zero rows
 * and every login attempt returned "Invalid email or password" no matter what
 * was typed. This GUC admits SELECT on users for exactly that lookup.
 *
 * It is deliberately separate from app.is_super_admin: it grants a single
 * read, never UPDATE or DELETE, so a login request cannot mutate anyone's
 * account beyond what the *_own policies already allow.
 *
 * `credential` names the bearer value the lookup is matching — a reset token
 * hash, a verification token hash, an OAuth code. #3218: 0134's credential-table
 * SELECT arms are gated on this GUC alone (`app.token_credential`), because a
 * boolean flag cannot express *which* row the caller is looking for; without it a
 * pre-auth read that turns the flag on sees every live row of three secret-bearing
 * tables. A lookup that is not about a credential — login by email, SSO subject
 * match — passes nothing, and this clears the GUC in the same statement so a
 * value left on the connection by an earlier request cannot authorise this one.
 */
export async function setAuthLookupContext(tx?: RlsTransaction, credential?: string): Promise<void> {
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(
    sql`SELECT set_config('app.auth_lookup', 'true', ${isLocal}),
               set_config('app.token_credential', ${credential ?? ''}, ${isLocal})`
  );
}

/**
 * Resolve an identity *from* a verified token: acting user + the pre-auth read
 * privilege, applied in a single statement.
 *
 * #87: the two halves used to be two `SELECT set_config(…)` round-trips. That
 * is the price of *one extra statement* (PP-028: a flat ~200 ms each), paid on
 * every session redemption, i.e. every authenticated request that the
 * AuthContext cache did not already answer. Nothing about the privilege changes
 * here — same two GUCs, same values, same transaction-local scope — only the
 * number of times we ask for them.
 */
export async function setAuthResolutionContext(userId: string, tx?: RlsTransaction): Promise<void> {
  if (!userId) {
    throw new Error('[RLS] setAuthResolutionContext called with empty userId — refusing to set empty context');
  }
  const client = tx || db;
  if (isMockClient(client)) return;
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(
    sql`SELECT set_config('app.current_user', ${userId}, ${isLocal}),
               set_config('app.auth_lookup', 'true', ${isLocal}),
               set_config('app.token_credential', '', ${isLocal})`
  );
}

/**
 * Run a pre-auth credential lookup (login, SSO subject match) with the minimum
 * read privilege it needs. Keep the callback to the lookup itself.
 *
 * `credential` is the bearer value the lookup matches on; see
 * setAuthLookupContext for why naming it is what makes the credential-table arms
 * narrow, and why a lookup that has no credential must pass nothing.
 */
export async function withAuthLookupContext<T>(
  fn: (tx: RlsTransaction) => Promise<T>,
  credential?: string
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setAuthLookupContext(tx, credential);
    return fn(tx);
  });
}

/**
 * Name an OAuth client to the pre-auth read that authenticates it (#3225).
 *
 * `POST /api/auth/oauth/token` starts by reading `oauth_clients` for the presented
 * `client_id` to verify the `client_secret` against it. That read is authenticated by
 * a client secret, not by a session or a workspace, so nothing sets
 * `app.current_tenant` — and `oauth_clients`' only arm was 0088's `tenant_isolation`.
 * Measured on the local force-RLS dev database as `nucrm_app`: the read returns 0 rows
 * with no context and 0 rows with `app.auth_lookup` alone, and 1 row once
 * `app.current_tenant` names the client's own tenant — i.e. the policy, not an absent
 * row. Every grant the endpoint serves died at that first statement with
 * `401 invalid_client`, for a correct client id and a correct secret.
 *
 * `app.oauth_client_id` is 0136's `oauth_clients_client_lookup` predicate, and it is
 * deliberately NOT a share of `app.token_credential`: that slot holds bearer material —
 * a token hash, an authorization code, a refresh token — and is cleared under the rules
 * written for secrets, while a client id is a public identifier the caller just typed
 * into a form field. Keeping them apart also means a context opened to authenticate one
 * client cannot satisfy a credential table's arm, or vice versa.
 *
 * `app.auth_lookup` is reused as the privilege flag because that is what it already
 * means — "this request is doing a pre-auth identity read", SELECT-only, never a write.
 * `app.token_credential` is cleared in the same statement: this context is about a
 * client, not about a presented credential, and a value left on the connection by an
 * earlier request must not authorise it (#2446).
 */
export async function setOAuthClientLookupContext(tx: RlsTransaction, clientId: string): Promise<void> {
  if (!clientId) {
    throw new Error('[RLS] setOAuthClientLookupContext called with an empty clientId — refusing to open a lookup context that can name no client');
  }
  if (isMockClient(tx)) return;
  await tx.execute(
    sql`SELECT set_config('app.auth_lookup', 'true', true),
               set_config('app.token_credential', '', true),
               set_config('app.oauth_client_id', ${clientId}, true)`
  );
}

/**
 * Look up one `oauth_clients` row by the `client_id` its caller authenticated with.
 * Keep the callback to the lookup itself, as with the other contexts here: this can
 * SELECT a row that carries a `client_secret`, and only `id` and that secret have a
 * reader in the route that calls it.
 */
export async function withOAuthClientLookupContext<T>(
  clientId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setOAuthClientLookupContext(tx, clientId);
    return fn(tx);
  });
}

/**
 * Mark the transaction as issuing a pre-auth credential token.
 *
 * `password_resets`, `email_verifications`, `oauth_codes` and `oauth_tokens` carry only
 * `*_user_own` policies keyed on app.current_user — a value that does not exist before a
 * user has logged in. Pre-auth flows (password reset, email verification, and the OAuth
 * code/token issuance, rotation and revocation) cannot write their rows under those
 * policies: a claim UPDATE or a retirement DELETE matches zero rows, silently.
 *
 * `app.token_issue` admits those writes on exactly those four tables — 0134/0135 for
 * the first three, 0136 for the refresh rotation, 0137 for an access-token revocation —
 * gated by each policy's own freshness / consumed-flag conditions. It is
 * deliberately NOT `app.auth_lookup`: that GUC means "this request is doing a
 * credential lookup" (SELECT only); a claim is a mutation. Mixing them would
 * let a lookup context also write.
 *
 * Set for the shortest possible sequence — the INSERT, UPDATE or DELETE that creates,
 * consumes or retires the credential — and cleared on connection release by both reset
 * lists (`lib/db/pool.ts`, `lib/db/request-connection.ts`).
 *
 * `scope` says which credential the write is about, and it is not decoration.
 * Measured on the local force-RLS dev database against 0134's own policies: an
 * `UPDATE … .returning()` claim in a transaction carrying only `app.token_issue`
 * matched **0 rows and consumed nothing**, because a row an RLS role cannot see
 * through a SELECT policy cannot be updated either, and 0134's only SELECT arm on
 * those tables is gated on `app.auth_lookup`, which claim transactions never set.
 * 0135 adds a claim-context read arm gated on `app.token_issue` + the credential,
 * so naming it here is what makes the claim work at all — and it is the same value
 * that keeps the arm to exactly one row.
 *
 * `retireUser` is for the other shape of pre-auth write: retiring every outstanding
 * token of a user (#3075), which has no single credential to name. It authorises a
 * tombstone on that user's rows and nothing else.
 */
export type CredentialWriteScope = {
  /** The token hash / code the write is about, exactly as the query binds it. */
  credential?: string;
  /** The user whose outstanding credentials are being retired, if that is this write. */
  retireUser?: string;
};

export async function setTokenIssueContext(
  tx?: RlsTransaction,
  scope: CredentialWriteScope = {}
): Promise<void> {
  const client = tx || db;
  if (isMockClient(client)) return;
  if (scope.credential !== undefined && !scope.credential) {
    throw new Error('[RLS] setTokenIssueContext called with an empty credential — refusing to open a claim context that can name no row');
  }
  if (scope.retireUser !== undefined && !scope.retireUser) {
    throw new Error('[RLS] setTokenIssueContext called with an empty retireUser — refusing to set an empty context');
  }
  const isLocal = tx ? sql`true` : sql`false`;
  await client.execute(
    sql`SELECT set_config('app.token_issue', 'true', ${isLocal}),
               set_config('app.token_credential', ${scope.credential ?? ''}, ${isLocal}),
               set_config('app.token_retire_user', ${scope.retireUser ?? ''}, ${isLocal})`
  );
}

/**
 * Run `fn` inside a transaction carrying the `app.token_issue` privilege for
 * its full duration. Used by pre-auth credential issuance (password reset
 * request, email verification, OAuth code issuance) and claim/consume (marking
 * a token deleted_at / used_at) where no authenticated user exists yet.
 *
 * Pass the `scope` the write is authorised by: see setTokenIssueContext.
 */
export async function withTokenIssueContext<T>(
  fn: (tx: RlsTransaction) => Promise<T>,
  scope: CredentialWriteScope = {}
): Promise<T> {
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setTokenIssueContext(tx, scope);
    return fn(tx);
  });
}

/**
 * Redeem a *verified* session token — the full pre-tenant read sequence that
 * turns a presented cookie into an AuthContext.
 *
 * Combines two narrow privileges in a single transaction:
 *   app.current_user = userId   (taken from a cryptographically verified
 *                                session token, never from client input)
 *   app.auth_lookup  = 'true'   (admits the keyed sessions/users lookups)
 *
 * WHY BOTH ARE NEEDED (PP-026)
 * The only policy on `sessions` was `sessions_user_own`, whose USING clause
 * keys off app.current_user — the very value the redemption read exists to
 * establish. Chicken and egg: a session minted at login could never be
 * redeemed, so every authenticated request answered 401 "Session expired"
 * while signup/login themselves kept returning 2xx. `tenant_members` and
 * `roles` had the same shape via tenant_isolation (they need a tenant the
 * membership read is supposed to discover); 0127 (#2626) adds self-scoped
 * SELECT policies for them instead of widening the tenant-bound ones.
 *
 * Read-only by construction: neither GUC grants INSERT/UPDATE/DELETE here.
 */
export async function withAuthResolutionContext<T>(
  userId: string,
  fn: (tx: RlsTransaction) => Promise<T>
): Promise<T> {
  if (!userId) {
    throw new Error('[RLS] withAuthResolutionContext called with empty userId');
  }
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setAuthResolutionContext(userId, tx);
    return fn(tx);
  });
}
