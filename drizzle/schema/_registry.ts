/**
 * NuCRM - Drizzle Schema Registry
 * 
 * Centralized table registry for deployment, validation, and type-safe access.
 * This file serves as the single source of truth for all database tables.
 */


// =============================================================================
// TABLE DEFINITION TYPES
// =============================================================================

/** Metadata about a table for deployment and validation */
export interface TableMetadata {
  name: string;
  schemaGroup: SchemaGroup;
  hasTenantId: boolean;
  hasSoftDelete: boolean;
  hasAudit: boolean;
  hasMetadata: boolean;
  dependencies: string[]; // table names this table depends on
  description: string;
  isCore: boolean;
  indexes: string[];
}

/** Group categorization for tables */
export type SchemaGroup = 
  | 'core'       // tenants, users, roles, auth
  | 'crm'        // contacts, deals, companies, pipelines
  | 'comm'       // emails, calls, meetings, templates
  | 'automation' // workflows, triggers, actions
  | 'infra'      // system settings, backups, announcements
  | 'marketing'  // campaigns, forms, assets
  | 'support'    // tickets, conversations
  | 'knowledge'  // KB articles, categories
  | 'tokens'     // API keys, sessions
  | 'modules'    // custom modules, extensions
  | 'segments'   // contact segments, lists
  | 'ai'         // ai provider secrets, activity, templates
  | 'billing'    // invoices, payments, subscriptions
  | 'history'    // audit trails, field snapshots
  | 'documents'  // document storage, folders
  | 'esignature' // electronic signatures
  | 'projects'   // project management
;

/** Complete table registry entry */
export interface TableRegistryEntry {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  metadata: TableMetadata;
}

/** Union type of all table names for type safety */
export type TableName = keyof typeof TABLE_REGISTRY;

// =============================================================================
// TABLE REGISTRY DEFINITION
// =============================================================================

// Entries live in ./registry/<schema-group>.ts. This file composes them and
// owns the types and lookup helpers.
import { CORE_TABLES } from './registry/core';
import { CRM_TABLES } from './registry/crm';
import { COMM_TABLES } from './registry/comm';
import { AUTOMATION_TABLES } from './registry/automation';
import { INFRA_TABLES } from './registry/infra';
import { MARKETING_TABLES } from './registry/marketing';
import { SUPPORT_TABLES } from './registry/support';
import { TOKENS_TABLES } from './registry/tokens';
import { MODULES_TABLES } from './registry/modules';
import { SEGMENTS_TABLES } from './registry/segments';
import { KNOWLEDGE_TABLES } from './registry/knowledge';
import { BILLING_TABLES } from './registry/billing';
import { HISTORY_TABLES } from './registry/history';
import { AI_TABLES } from './registry/ai';
import { DOCUMENTS_TABLES } from './registry/documents';
import { ESIGNATURE_TABLES } from './registry/esignature';
import { PROJECTS_TABLES } from './registry/projects';

export const TABLE_REGISTRY = {
  ...CORE_TABLES,
  ...CRM_TABLES,
  ...COMM_TABLES,
  ...AUTOMATION_TABLES,
  ...INFRA_TABLES,
  ...MARKETING_TABLES,
  ...SUPPORT_TABLES,
  ...TOKENS_TABLES,
  ...MODULES_TABLES,
  ...SEGMENTS_TABLES,
  ...KNOWLEDGE_TABLES,
  ...BILLING_TABLES,
  ...HISTORY_TABLES,
  ...AI_TABLES,
  ...DOCUMENTS_TABLES,
  ...ESIGNATURE_TABLES,
  ...PROJECTS_TABLES,
};

// =============================================================================
// SCHEMA GROUP ACCESS
// =============================================================================

/**
 * Get all tables in a specific schema group.
 * Useful for module-based migrations and validations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTablesByGroup(group: SchemaGroup): Record<string, any> {
  return Object.fromEntries(
    Object.entries(TABLE_REGISTRY)
      .filter(([_, entry]) => entry.metadata.schemaGroup === group)
      .map(([name, entry]) => [name, entry.table])
  );
}

/**
 * Get all table names in a specific schema group.
 */
export function getTableNamesByGroup(group: SchemaGroup): string[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.schemaGroup === group)
    .map(([name]) => name);
}

// =============================================================================
// DEPLOYMENT UTILITIES
// =============================================================================

/**
 * Get tables sorted by dependency order (dependencies first).
 * Useful for creating tables in the correct order during migration.
 */
export function getTablesInDependencyOrder(): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(tableName: string): void {
    if (visited.has(tableName)) return;
    
    const entry = TABLE_REGISTRY[tableName as keyof typeof TABLE_REGISTRY];
    if (!entry) return;

    // Visit dependencies first
    for (const dep of entry.metadata.dependencies) {
      if (dep in TABLE_REGISTRY) {
        visit(dep);
      }
    }

    visited.add(tableName);
    result.push(tableName);
  }

  // Visit all tables
  for (const tableName of Object.keys(TABLE_REGISTRY)) {
    visit(tableName);
  }

  return result;
}

/**
 * Get all tables that have a specific feature.
 */
export function getTablesWithFeature(feature: keyof TableMetadata): string[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata[feature])
    .map(([name]) => name);
}

/**
 * Check if a table exists in the registry.
 */
export function tableExists(tableName: string): tableName is TableName {
  return tableName in TABLE_REGISTRY;
}

/**
 * Get metadata for a specific table.
 */
export function getTableMetadata(tableName: TableName): TableMetadata {
  const entry = TABLE_REGISTRY[tableName];
  if (!entry) {
    throw new Error(`Table '${tableName}' not found in registry`);
  }
  return entry.metadata as TableMetadata;
}

/**
 * Get all table names as an array.
 */
export function getAllTableNames(): TableName[] {
  return Object.keys(TABLE_REGISTRY) as TableName[];
}

/**
 * Get all core tables (required for basic functionality).
 */
export function getCoreTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.isCore)
    .map(([name]) => name) as TableName[];
}

/**
 * Get all tenant-scoped tables.
 */
export function getTenantTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.hasTenantId)
    .map(([name]) => name) as TableName[];
}

/**
 * Get all tables with soft delete support.
 */
export function getSoftDeleteTables(): TableName[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([_, entry]) => entry.metadata.hasSoftDelete)
    .map(([name]) => name) as TableName[];
}
