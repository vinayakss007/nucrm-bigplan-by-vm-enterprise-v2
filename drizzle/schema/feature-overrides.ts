import { pgTable, uuid, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants, users } from './core';
import * as utils from './utils';

// ── TENANT FEATURE OVERRIDES ──────────────────────────
// Super admin granular feature control per tenant.
// Allows enabling/disabling specific features regardless of plan.
export const tenantFeatureOverrides = pgTable('tenant_feature_overrides', {
  id: utils.pk(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow(),
  reason: text('reason'),
  ...utils.lifecycle(),
  metadata: utils.metadata(),
}, (table) => {
  return {
    uniqueTenantFeature: uniqueIndex('idx_tenant_feature_overrides_unique').on(table.tenantId, table.featureKey),
  };
});
