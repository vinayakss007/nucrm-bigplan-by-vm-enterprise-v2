/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `modules` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  modules,
  tenantModules,
} from '../modules';
import {
  customPlugins,
  pluginExecutionLogs,
} from '../plugins';
import {
  productTemplates,
  tenantTemplates,
} from '../templates';

export const MODULES_TABLES = {

  // Modules tables
  modules: {
    table: modules,
    metadata: {
      name: 'modules',
      schemaGroup: 'modules',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Module registry',
      isCore: true,
      indexes: [],
    },
  },
  tenantModules: {
    table: tenantModules,
    metadata: {
      name: 'tenant_modules',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'modules', 'users'],
      description: 'Tenant module installations',
      isCore: false,
      indexes: ['idx_tenant_modules_unique', 'idx_tenant_modules_tenant'],
    },
  },
  customPlugins: {
    table: customPlugins,
    metadata: {
      name: 'custom_plugins',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Custom user-defined API plugins',
      isCore: false,
      indexes: ['idx_custom_plugins_tenant', 'idx_custom_plugins_user', 'idx_custom_plugins_status', 'idx_custom_plugins_metadata_g', 'idx_custom_plugins_active'],
    },
  },
  pluginExecutionLogs: {
    table: pluginExecutionLogs,
    metadata: {
      name: 'plugin_execution_logs',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'customPlugins'],
      description: 'Plugin action execution logs',
      isCore: false,
      indexes: ['idx_plugin_execution_logs_tenant', 'idx_plugin_execution_logs_plugin', 'idx_plugin_execution_logs_success'],
    },
  },
  // Product template tables
  productTemplates: {
    table: productTemplates,
    metadata: {
      name: 'product_templates',
      schemaGroup: 'modules',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['users'],
      description: 'Product template definitions for onboarding',
      isCore: false,
      indexes: ['idx_product_templates_slug', 'idx_product_templates_status'],
    },
  },
  tenantTemplates: {
    table: tenantTemplates,
    metadata: {
      name: 'tenant_templates',
      schemaGroup: 'modules',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'productTemplates', 'users'],
      description: 'Template assignments to tenants',
      isCore: false,
      indexes: ['idx_tenant_templates_unique'],
    },
  },
};
