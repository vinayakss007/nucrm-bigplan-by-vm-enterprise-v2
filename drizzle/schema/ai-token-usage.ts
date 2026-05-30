import { uniqueIndex, pgTable, text, timestamp, bigint, index } from 'drizzle-orm/pg-core';
import * as utils from './utils';

/**
 * AI Token Usage - Monthly token tracking per tenant.
 * Tracks how many AI tokens each tenant has consumed per billing period,
 * with optional super admin overrides on the limit.
 */
export const aiTokenUsage = pgTable('ai_token_usage', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  /** Billing period in 'YYYY-MM' format */
  billingPeriod: text('billing_period').notNull(),
  /** Total tokens consumed this billing period */
  tokensUsed: bigint('tokens_used', { mode: 'number' }).notNull().default(0),
  /** Super admin override for token limit (null = use plan default) */
  tokensLimit: bigint('tokens_limit', { mode: 'number' }),
  /** When the usage counter was last reset */
  resetAt: timestamp('reset_at', { withTimezone: true }),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantPeriodIdx: uniqueIndex('idx_ai_token_usage_tenant_period').on(table.tenantId, table.billingPeriod),
    tenantIdx: index('idx_ai_token_usage_tenant').on(table.tenantId),
  };
});
