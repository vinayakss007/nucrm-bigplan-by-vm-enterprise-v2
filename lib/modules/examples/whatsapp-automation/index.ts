/**
 * WhatsApp Automation Module
 *
 * This module is a standalone mini-SaaS that provides:
 * - WhatsApp Business API integration
 * - Template message management
 * - Auto-reply workflows
 * - Bulk campaign sending
 * - Analytics dashboard
 *
 * It plugs into the CRM but can also work independently.
 * The CRM provides: contacts, deals, tenant management, RBAC, billing.
 * The module provides: WhatsApp messaging, templates, campaigns.
 */
import { defineModule } from '../../sdk/types';

export default defineModule({
  id: 'whatsapp-automation',
  name: 'WhatsApp Automation',
  version: '1.0.0',
  description: 'WhatsApp Business API — send messages, auto-replies, campaigns with analytics',
  author: 'Abetworks',
  category: 'messaging',
  icon: '💬',
  minCrmVersion: '1.0.0',
  pricing: {
    free: { enabled: false },
    starter: { enabled: true, price: 19 },
    pro: { enabled: true, price: 19 },
    enterprise: { enabled: true, price: 0 },
  },
  features: [
    'WhatsApp Business API',
    'Template messages',
    'Auto-replies',
    'Bulk campaigns',
    'Analytics dashboard',
    'Contact sync',
    'Message history',
    'Scheduling',
  ],
  permissions: [
    'whatsapp.view',
    'whatsapp.send',
    'whatsapp.templates',
    'whatsapp.campaigns',
    'whatsapp.analytics',
  ],
  pages: [
    { path: '/tenant/whatsapp', label: 'WhatsApp', icon: 'MessageSquare' },
    { path: '/tenant/whatsapp/templates', label: 'Templates', icon: 'FileText' },
    { path: '/tenant/whatsapp/campaigns', label: 'Campaigns', icon: 'Megaphone' },
    { path: '/tenant/whatsapp/analytics', label: 'Analytics', icon: 'BarChart3' },
  ],
  settings_schema: [
    { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', required: true, placeholder: '1234567890' },
    { key: 'access_token', label: 'Access Token', type: 'password', required: true, help: 'Meta/WhatsApp permanent access token' },
    { key: 'verify_token', label: 'Webhook Verify Token', type: 'text', required: false, help: 'For receiving incoming messages' },
    { key: 'business_account_id', label: 'Business Account ID', type: 'text', required: true },
  ],
  webhooks: [
    'whatsapp.message_received',
    'whatsapp.message_delivered',
    'whatsapp.message_read',
  ],
  dependsOn: ['core-crm'],
});
