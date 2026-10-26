/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The pre-auth plugin-webhook claim (#3246), its own module the way #2472 split the
 * portal lookup and #3163 split the form capture — `lib/db/rls.ts` is under the
 * #1843/#422 500-line ratchet.
 *
 * `POST /api/tenant/plugins/webhook/[id]` authenticates with an HMAC over the body plus
 * the row's own `webhook_secret`, so it has to read that row before it knows who is
 * calling. `custom_plugins`' only arm, `tenant_isolation`, keys on `app.current_tenant` —
 * which both reset lists pin to '' — and `tenant_id` is NOT NULL, so the read matched zero
 * rows and the route answered 404 "Plugin" before it could check a signature. Migration
 * 0139 adds the SELECT-only arm this module names: one row by primary key, no tenant
 * widening, nothing else granted. The id is public enough to be in a URL and proves nothing
 * by itself — the secret in the row is what the caller still has to show.
 *
 * `app.plugin_webhook_id` joins BOTH connection-reset lists (`lib/db/pool.ts`,
 * `lib/db/request-connection.ts`), as #2446 requires of every privilege GUC.
 */

import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { hasTransaction, isMockClient, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { isUuid } from '@/lib/id';

/** The GUC migration 0139's claim arm keys off. A constant so both reset lists can name it. */
export const PLUGIN_WEBHOOK_GUC = 'app.plugin_webhook_id';

/**
 * `custom_plugins.id` is a uuid column and 0139 casts this value to `uuid`, so an
 * unvalidated string would be a `22P02` on a public endpoint — the class #2288
 * removed from this route's body handling.
 */
export function pluginWebhookValue(pluginId: string): string {
  const value = (pluginId ?? '').trim();
  if (!value) {
    throw new Error('[RLS] plugin webhook claim called with an empty pluginId — refusing to open a context that can name no row');
  }
  if (!isUuid(value)) {
    throw new Error(`[RLS] plugin webhook claim pluginId "${value.slice(0, 40)}" is not a uuid — 0139's clause casts it, so this would be a 22P02 on a public endpoint`);
  }
  return value;
}

/** Transaction-local by construction: a claim that outlived its read is the leak #2446 is about. */
export async function setPluginWebhookLookupContext(tx: RlsTransaction, pluginId: string): Promise<void> {
  const value = pluginWebhookValue(pluginId);
  if (isMockClient(tx)) return;
  await tx.execute(sql`SELECT set_config(${PLUGIN_WEBHOOK_GUC}, ${value}, true)`);
}

/**
 * Close the claim and name the plugin's own tenant, in one statement.
 *
 * Called after the signature check passed, so the execution-log write that follows
 * runs under `tenant_isolation` like every other insert into
 * `plugin_execution_logs`. 0139 grants nothing on that table.
 */
export async function setPluginWebhookTenantContext(tx: RlsTransaction, tenantId: string): Promise<void> {
  if (!tenantId) {
    throw new Error('[RLS] setPluginWebhookTenantContext called with an empty tenantId — refusing to set an empty context');
  }
  if (isMockClient(tx)) return;
  await tx.execute(
    sql`SELECT set_config(${PLUGIN_WEBHOOK_GUC}, '', true),
               set_config('app.current_tenant', ${tenantId}, true),
               set_config('app.current_user', ${NO_USER_SENTINEL}, true)`
  );
}

/**
 * Run `fn` in one transaction carrying 0139's claim on exactly one plugin row.
 * Keep the callback to the lookup and the writes that follow it.
 */
export async function withPluginWebhookLookupContext<T>(
  pluginId: string,
  fn: (tx: RlsTransaction) => Promise<T>,
): Promise<T> {
  const value = pluginWebhookValue(pluginId);
  if (!hasTransaction(db)) return fn(db as unknown as Parameters<typeof fn>[0]);
  return await db.transaction(async (tx) => {
    await setPluginWebhookLookupContext(tx, value);
    return fn(tx);
  });
}
