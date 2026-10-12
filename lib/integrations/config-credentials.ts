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
