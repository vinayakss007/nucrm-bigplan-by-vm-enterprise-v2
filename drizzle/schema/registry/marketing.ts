/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `marketing` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  sequences,
  sequenceSteps,
  sequenceStepLogs,
  sequenceEnrollments,
} from '../marketing';
import {
  leadWarmingEvents,
  leadWarmingCampaigns,
  leadWarmingMessages,
  leadWarmingReplies,
  leadWarmingSchedule,
} from '../lead-warming';

export const MARKETING_TABLES = {

  // Marketing tables
  sequences: {
    table: sequences,
    metadata: {
      name: 'sequences',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Email sequences',
      isCore: false,
      indexes: ['idx_sequences_tenant', 'idx_sequences_metadata_g', 'idx_sequences_active'],
    },
  },
  sequenceSteps: {
    table: sequenceSteps,
    metadata: {
      name: 'sequence_steps',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['sequences', 'tenants'],
      description: 'Steps in a sequence',
      isCore: false,
      indexes: ['idx_sequence_steps_seq', 'idx_sequence_steps_tenant'],
    },
  },
  sequenceStepLogs: {
    table: sequenceStepLogs,
    metadata: {
      name: 'sequence_step_logs',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['sequenceEnrollments', 'sequenceSteps', 'tenants'],
      description: 'Sequence execution logs',
      isCore: false,
      indexes: ['idx_sequence_step_logs_enrollment', 'idx_sequence_step_logs_scheduled', 'idx_sequence_step_logs_tenant'],
    },
  },
  sequenceEnrollments: {
    table: sequenceEnrollments,
    metadata: {
      name: 'sequence_enrollments',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'sequences', 'contacts', 'users'],
      description: 'Contact enrollments in sequences',
      isCore: false,
      indexes: ['idx_sequence_enrollments_tenant', 'idx_seq_enroll_contact', 'idx_seq_enroll_seq', 'idx_seq_enroll_status', 'idx_sequence_enrollments_metadata_g'],
    },
  },

  leadWarmingEvents: {
    table: leadWarmingEvents,
    metadata: {
      name: 'lead_warming_events',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Lead warming event/festival calendar entries',
      isCore: false,
      indexes: ['idx_lead_warming_events_tenant', 'idx_lead_warming_events_type', 'idx_lead_warming_events_month_day', 'idx_lead_warming_events_active'],
    },
  },
  leadWarmingCampaigns: {
    table: leadWarmingCampaigns,
    metadata: {
      name: 'lead_warming_campaigns',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'users'],
      description: 'Lead warming campaign configurations',
      isCore: false,
      indexes: ['idx_lead_warming_campaigns_tenant', 'idx_lead_warming_campaigns_status', 'idx_lead_warming_campaigns_active'],
    },
  },
  leadWarmingMessages: {
    table: leadWarmingMessages,
    metadata: {
      name: 'lead_warming_messages',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns', 'leadWarmingEvents'],
      description: 'Sent lead warming message log',
      isCore: false,
      indexes: ['idx_lead_warming_msg_campaign', 'idx_lead_warming_msg_contact', 'idx_lead_warming_msg_status', 'idx_lead_warming_msg_channel'],
    },
  },
  leadWarmingReplies: {
    table: leadWarmingReplies,
    metadata: {
      name: 'lead_warming_replies',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: true,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns', 'leadWarmingMessages'],
      description: 'AI-analyzed lead warming reply records',
      isCore: false,
      indexes: ['idx_lead_warming_replies_message', 'idx_lead_warming_replies_contact', 'idx_lead_warming_replies_intent', 'idx_lead_warming_replies_unanalyzed', 'idx_lead_warming_replies_positive'],
    },
  },
  leadWarmingSchedule: {
    table: leadWarmingSchedule,
    metadata: {
      name: 'lead_warming_schedule',
      schemaGroup: 'marketing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants', 'contacts', 'leadWarmingCampaigns'],
      description: 'Per-contact lead warming sending schedule',
      isCore: false,
      indexes: ['idx_lead_warming_sched_unique', 'idx_lead_warming_sched_tenant', 'idx_lead_warming_sched_eligible'],
    },
  },
};
