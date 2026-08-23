/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { pgTable, uuid, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql, isNull, isNotNull } from 'drizzle-orm';
import { tenants } from './core';
import * as utils from './utils';

export const platformSettings = pgTable('platform_settings', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').default({}),
  ...utils.lifecycle(),
}, (table) => {
  return {
    keyIdx: index('idx_platform_settings_key').on(table.key).where(sql`key IS NOT NULL`),
    tenantIdx: utils.tenantIdx(table),
    uniqueGlobalKey: uniqueIndex('idx_platform_settings_global_unique').on(table.key).where(isNull(table.tenantId)),
    uniqueTenantKey: uniqueIndex('idx_platform_settings_tenant_unique').on(table.key, table.tenantId).where(isNotNull(table.tenantId)),
  };
});
