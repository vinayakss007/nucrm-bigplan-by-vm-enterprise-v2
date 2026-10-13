/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * `integrations.config` (`drizzle/schema/comm.ts:204`, `jsonb`) is a bag that
 * demonstrably holds live credentials, not just settings:
 *   - webhook signing secrets — `app/api/tenant/webhooks/route.ts:108`
 *     (`config: { url, events, secret }`, written with `type: 'webhook'` at `:106`)
 *   - Google/Outlook `accessToken` + `refreshToken` — `lib/calendar-sync/service.ts:49-50`
 *   - provider API keys and bot tokens — `lib/integrations/providers/*.ts:16`
 *     (`api_key`, `bot_token`), submitted through `POST /api/tenant/plugin-engine`
 *
 * None of them may leave a tenant API. `config` is still needed for the non-secret
 * settings the connectors show (`url`, `events`, `chat_id`), so secret *keys* are
 * removed here and only their names reported back, which is what lets a UI say
 * "3 credentials stored" without ever holding one.
 *
 * Matched by name pattern rather than an exact key list, so the usual casing and
 * underscore variants of the same credential (`SigningSecret`, `api_key`,
 * `ACCESS_TOKEN`) are all caught. A connector that invents a wholly unrecognisable
 * key name would still slip through — which is why the pattern lives next to the
 * integration subsystem rather than being widened into some generic JSON scrubber.
 *
 * Shared by every route that reads this column into a response
 * (`app/api/tenant/integrations/route.ts`, `app/api/tenant/plugin-engine/route.ts`):
 * two copies of a secret-name regex drift, and the second copy is the one that leaks.
 */
export const SECRET_CONFIG_KEY = /(secret|token|password|passwd|api[_-]?key|credential|access[_-]?key)/i;

export interface SplitConfigCredentials {
  /** `config` with every credential key removed — safe to serialize. */
  publicConfig: Record<string, unknown>;
  /** Names of the keys that were withheld. Never their values. */
  credentialKeys: string[];
}

export function splitConfigCredentials(config: unknown): SplitConfigCredentials {
  const publicConfig: Record<string, unknown> = {};
  const credentialKeys: string[] = [];
  for (const [key, value] of Object.entries((config ?? {}) as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEY.test(key)) credentialKeys.push(key);
    else publicConfig[key] = value;
  }
  return { publicConfig, credentialKeys };
}

/**
 * The write-side counterpart to {@link splitConfigCredentials} (#2562).
 *
 * `GET` withholds every `SECRET_CONFIG_KEY` name, so a client doing the documented
 * read→edit→write cycle can only ever send back a bag that has *lost* those keys.
 * Assigning that bag to the column deletes the tenant's webhook signing secret and
 * its Google/Outlook refresh token while answering `success: true`.
 *
 * Merging — stored bag first, caller's keys over it — means a PATCH can only change
 * keys the caller actually named, and a caller who does hold a fresh credential can
 * still write it: a `secret` in `incoming` overwrites the stored one rather than
 * being treated as a no-op.
 *
 * Keys absent from `incoming` are kept, not deleted; removing a credential is a
 * deliberate act this route has never offered, and inventing one here would widen
 * the blast radius of a dropped field to match the bug being fixed.
 *
 * Flat keys only — every writer listed above stores `config` as a flat object.
 *
 * Lives beside the mask because a preserved-key set and a stripped-key set that
 * disagree is the next leak-or-deletion bug; one module owns both directions.
 */
export function mergeKeepingSecretKeys(
  existing: unknown,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const base = (existing ?? {}) as Record<string, unknown>;
  return { ...base, ...incoming };
}
