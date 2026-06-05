import { pgTable, uuid, text, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

// ── Exchange Rates ────────────────────────────────────
export const exchangeRates = pgTable('exchange_rates', {
  id: utils.pk(),
  baseCurrency: text('base_currency').notNull(),
  targetCurrency: text('target_currency').notNull(),
  rate: numeric('rate', { precision: 16, scale: 8 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  source: text('source').notNull().default('exchangerate-api'),
  ...utils.lifecycle(),
}, (table) => {
  return {
    currencyPairIdx: index('idx_exchange_rates_pair').on(table.baseCurrency, table.targetCurrency),
    fetchedAtIdx: index('idx_exchange_rates_fetched').on(table.fetchedAt),
  };
});

// ── Tax Rates ─────────────────────────────────────────
export const taxRates = pgTable('tax_rates', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  rate: numeric('rate', { precision: 8, scale: 4 }).notNull(),
  type: text('type').notNull().default('percentage'), // 'percentage' | 'fixed'
  country: text('country'),
  state: text('state'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    regionIdx: index('idx_tax_rates_region').on(table.country, table.state),
    activeIdx: index('idx_tax_rates_active').on(table.tenantId, table.isActive),
  };
});

// ── Tax Exemptions ────────────────────────────────────
export const taxExemptions = pgTable('tax_exemptions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  entityType: text('entity_type').notNull(), // 'contact' | 'company' | 'deal'
  entityId: uuid('entity_id').notNull(),
  reason: text('reason').notNull(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_tax_exemptions_entity').on(table.entityType, table.entityId),
  };
});
