/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Table registry entries for the `billing` schema group.
 *
 * Extracted from drizzle/schema/_registry.ts, which had grown to 3,754 lines.
 * Entry bodies are unchanged; see ../_registry.ts for the composed
 * TABLE_REGISTRY and the helpers that read it.
 */

import {
  services,
  serviceCategories,
  invoices,
  invoiceLineItems,
  invoicePayments,
  orders,
  orderLineItems,
  contracts,
  serviceSubscriptions,
} from '../billing';
import {
  exchangeRates,
  taxRates,
  taxExemptions,
} from '../financial';

export const BILLING_TABLES = {
  // Billing tables
  services: {
    table: services,
    metadata: {
      name: 'services',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Billable services',
      isCore: false,
      indexes: [],
    },
  },
  serviceCategories: {
    table: serviceCategories,
    metadata: {
      name: 'service_categories',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants'],
      description: 'Service categories',
      isCore: false,
      indexes: [],
    },
  },
  invoices: {
    table: invoices,
    metadata: {
      name: 'invoices',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer invoices',
      isCore: false,
      indexes: [],
    },
  },
  invoiceLineItems: {
    table: invoiceLineItems,
    metadata: {
      name: 'invoice_line_items',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['invoices'],
      description: 'Invoice line items',
      isCore: false,
      indexes: [],
    },
  },
  invoicePayments: {
    table: invoicePayments,
    metadata: {
      name: 'invoice_payments',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'invoices'],
      description: 'Invoice payment records',
      isCore: false,
      indexes: [],
    },
  },
  orders: {
    table: orders,
    metadata: {
      name: 'orders',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer orders',
      isCore: false,
      indexes: [],
    },
  },
  orderLineItems: {
    table: orderLineItems,
    metadata: {
      name: 'order_line_items',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: false,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['orders'],
      description: 'Order line items',
      isCore: false,
      indexes: [],
    },
  },
  contracts: {
    table: contracts,
    metadata: {
      name: 'contracts',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users'],
      description: 'Customer contracts',
      isCore: false,
      indexes: [],
    },
  },
  serviceSubscriptions: {
    table: serviceSubscriptions,
    metadata: {
      name: 'service_subscriptions',

      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: true,
      hasMetadata: true,
      dependencies: ['tenants', 'users', 'services'],
      description: 'Service subscriptions',
      isCore: false,
      indexes: [],
    },
  },
  exchangeRates: {
    table: exchangeRates,
    metadata: {
      name: 'exchange_rates',
      schemaGroup: 'billing',
      hasTenantId: false,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: [],
      description: 'Currency exchange rate records',
      isCore: false,
      indexes: ['idx_exchange_rates_pair', 'idx_exchange_rates_fetched'],
    },
  },
  taxRates: {
    table: taxRates,
    metadata: {
      name: 'tax_rates',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tax rate configurations per region',
      isCore: false,
      indexes: ['idx_tax_rates_tenant', 'idx_tax_rates_region', 'idx_tax_rates_active'],
    },
  },
  taxExemptions: {
    table: taxExemptions,
    metadata: {
      name: 'tax_exemptions',
      schemaGroup: 'billing',
      hasTenantId: true,
      hasSoftDelete: true,
      hasAudit: false,
      hasMetadata: false,
      dependencies: ['tenants'],
      description: 'Tax exemption records for entities',
      isCore: false,
      indexes: ['idx_tax_exemptions_tenant', 'idx_tax_exemptions_entity'],
    },
  },
};
