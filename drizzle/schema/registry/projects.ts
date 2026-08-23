/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `projects` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  projects,
  milestones,
  projectTasks,
} from '../projects';

export const PROJECTS_TABLES = {

  // Project Management tables
  projects: {
    table: projects,
    metadata: {
      name: 'projects',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Project records',
      isCore: false,
      indexes: ['idx_projects_tenant', 'idx_projects_status', 'idx_projects_owner', 'idx_projects_active'],
    },
  },
  milestones: {
    table: milestones,
    metadata: {
      name: 'milestones',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'projects'],
      description: 'Project milestone tracking',
      isCore: false,
      indexes: ['idx_milestones_tenant', 'idx_milestones_project'],
    },
  },
  projectTasks: {
    table: projectTasks,
    metadata: {
      name: 'project_tasks',
      schemaGroup: 'projects',
      hasTenantId: true,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'projects', 'tasks'],
      description: 'Junction table linking projects to tasks',
      isCore: false,
      indexes: ['idx_project_tasks_unique', 'idx_project_tasks_tenant'],
    },
  },
};
