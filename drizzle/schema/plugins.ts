import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from './core';
import * as utils from './utils';

// ── 1. CUSTOM PLUGINS ─────────────────────────────────
export const customPlugins = pgTable('custom_plugins', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  baseUrl: text('base_url').notNull(),
  authType: text('auth_type').notNull().default('none'), // 'bearer' | 'basic' | 'api_key_header' | 'api_key_query' | 'oauth2_client_credentials' | 'none'
  authConfig: jsonb('auth_config').default({}), // stores token/username/password/client_id/etc encrypted references
  customHeaders: jsonb('custom_headers').default({}),
  actions: jsonb('actions').default([]), // array of PluginAction objects
  webhookSecret: text('webhook_secret'),
  status: text('status').notNull().default('active'), // 'active' | 'disabled' | 'error'
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastError: text('last_error'),
  metadata: utils.metadata(),
  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    metadataIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
    userIdx: index('idx_custom_plugins_user').on(table.userId),
    statusIdx: index('idx_custom_plugins_status').on(table.tenantId, table.status),
  };
});

// ── 2. PLUGIN EXECUTION LOGS ──────────────────────────
export const pluginExecutionLogs = pgTable('plugin_execution_logs', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  pluginId: uuid('plugin_id').notNull().references(() => customPlugins.id, { onDelete: 'cascade' }),
  actionName: text('action_name').notNull(),
  method: text('method').notNull(),
  url: text('url').notNull(),
  requestHeaders: jsonb('request_headers').default({}),
  requestBody: jsonb('request_body'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  success: boolean('success').notNull().default(false),
  errorMessage: text('error_message'),
  metadata: utils.metadata(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    pluginIdx: index('idx_plugin_execution_logs_plugin').on(table.pluginId, table.createdAt),
    successIdx: index('idx_plugin_execution_logs_success').on(table.tenantId, table.success),
  };
});
