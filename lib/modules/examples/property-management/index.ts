/**
 * Property Management Module
 *
 * A complete mini-SaaS for real estate / property management.
 * Built on the CRM platform, it adds:
 * - Property listings with images, pricing, availability
 * - Tenant management with lease tracking
 * - Maintenance requests and work orders
 * - Rent collection and payment tracking
 * - Owner/landlord portal
 *
 * This shows how a CRM module becomes a standalone app.
 * The CRM provides: contacts, deals, tasks, calendar, invoicing.
 * The module provides: property management on top.
 */
import { defineModule } from '../../sdk/types';

export default defineModule({
  id: 'property-management',
  name: 'Property Management',
  version: '1.0.0',
  description: 'Complete property management — listings, tenants, leases, rent, maintenance',
  author: 'Abetworks',
  category: 'utility',
  icon: '🏠',
  minCrmVersion: '1.0.0',
  pricing: {
    free: { enabled: false },
    starter: { enabled: true, price: 29 },
    pro: { enabled: true, price: 29 },
    enterprise: { enabled: true, price: 0 },
  },
  features: [
    'Property listings with images',
    'Tenant management',
    'Lease tracking & renewals',
    'Rent collection',
    'Maintenance requests',
    'Owner/landlord portal',
    'Inspection scheduling',
    'Financial reports',
  ],
  permissions: [
    'property.view',
    'property.manage',
    'property.tenants',
    'property.leases',
    'property.maintenance',
    'property.finance',
  ],
  pages: [
    { path: '/tenant/properties', label: 'Properties', icon: 'Building2' },
    { path: '/tenant/properties/tenants', label: 'Tenants', icon: 'Users' },
    { path: '/tenant/properties/leases', label: 'Leases', icon: 'FileSignature' },
    { path: '/tenant/properties/maintenance', label: 'Maintenance', icon: 'Wrench' },
    { path: '/tenant/properties/finance', label: 'Finance', icon: 'DollarSign' },
    { path: '/tenant/properties/portal', label: 'Owner Portal', icon: 'ExternalLink' },
  ],
  settings_schema: [
    { key: 'default_lease_term', label: 'Default Lease Term (months)', type: 'number', required: true },
    { key: 'late_fee_percent', label: 'Late Fee %', type: 'number', required: false, help: 'Percentage of rent charged as late fee' },
    { key: 'enable_owner_portal', label: 'Enable Owner Portal', type: 'boolean', required: false },
  ],
  webhooks: [
    'property.lease_expiring',
    'property.rent_received',
    'property.maintenance_requested',
  ],
  dependsOn: ['core-crm', 'sales-quotes'],
});
