/**
 * Controllable Features Registry
 *
 * Defines the set of features that can be individually enabled/disabled
 * per tenant by the super admin via the feature-control API.
 */

export const CONTROLLABLE_FEATURES = [
  { key: 'telegram', label: 'Telegram Integration', description: 'Telegram bot notifications and alerts', category: 'messaging' },
  { key: 'email-sequences', label: 'Email Sequences', description: 'Automated email drip campaigns', category: 'marketing' },
  { key: 'ai-assistant', label: 'AI Assistant', description: 'Claude AI for email drafting, lead scoring, deal predictions', category: 'ai' },
  { key: 'whatsapp-bot', label: 'WhatsApp Automation', description: 'WhatsApp Business API messaging', category: 'messaging' },
  { key: 'lead-warming', label: 'Lead Warming', description: 'Auto festival/birthday greetings with AI', category: 'messaging' },
  { key: 'analytics-pro', label: 'Analytics Pro', description: 'Custom reports, PDF export, scheduled reports', category: 'analytics' },
  { key: 'automation-pro', label: 'Automation Pro', description: 'Visual workflow builder, multi-step sequences', category: 'automation' },
  { key: 'forms-builder', label: 'Forms Builder', description: 'Custom lead capture form builder', category: 'utility' },
  { key: 'compliance', label: 'Compliance Suite', description: 'GDPR, SOC 2, data retention policies', category: 'security' },
] as const;

export type FeatureKey = typeof CONTROLLABLE_FEATURES[number]['key'];
