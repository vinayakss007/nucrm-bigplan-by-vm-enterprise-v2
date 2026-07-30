/**
 * Integrations content.
 *
 * "Built in" means a first-party connector ships with the product.
 * "Connect it yourself" describes the integration engine: give it a base URL
 * and a key and it works out the request patterns for you — which is why we do
 * not need a marketplace of a thousand logos to answer "does it integrate with X".
 */

export type Connector = {
  name: string;
  category: string;
  icon: string;
  what: string;
  builtIn: boolean;
};

export const CONNECTORS: Connector[] = [
  { name: 'SendGrid', category: 'Email delivery', icon: 'Send', what: 'Transactional and bulk email delivery with tracking', builtIn: true },
  { name: 'Mailgun', category: 'Email delivery', icon: 'Mail', what: 'Email delivery with per-domain sending', builtIn: true },
  { name: 'Resend', category: 'Email delivery', icon: 'MailCheck', what: 'Modern transactional email delivery', builtIn: true },
  { name: 'Gmail', category: 'Mailbox sync', icon: 'Inbox', what: 'Two-way mailbox sync with automatic logging', builtIn: true },
  { name: 'Outlook', category: 'Mailbox sync', icon: 'Inbox', what: 'Two-way mailbox sync with automatic logging', builtIn: true },
  { name: 'WhatsApp Business', category: 'Messaging', icon: 'MessageCircle', what: 'Template messages, auto-replies and broadcasts', builtIn: true },
  { name: 'SMS gateways', category: 'Messaging', icon: 'Smartphone', what: 'Outbound SMS with delivery webhooks', builtIn: true },
  { name: 'Telegram', category: 'Messaging', icon: 'SendHorizontal', what: 'Internal alerting and notification bot', builtIn: true },
  { name: 'Slack', category: 'Chat-ops', icon: 'Hash', what: 'Post deal, lead and ticket alerts into channels', builtIn: true },
  { name: 'Stripe', category: 'Payments', icon: 'CreditCard', what: 'Payment tracking against invoices and subscriptions', builtIn: true },
  { name: 'OpenAI', category: 'AI providers', icon: 'Sparkles', what: 'Drafting, summarisation and scoring with your own key', builtIn: true },
  { name: 'Anthropic Claude', category: 'AI providers', icon: 'Sparkles', what: 'Alternative assistant provider with your own key', builtIn: true },
  { name: 'Google Calendar', category: 'Calendar', icon: 'CalendarDays', what: 'Two-way meeting and availability sync', builtIn: true },
  { name: 'SAML providers', category: 'Identity', icon: 'KeyRound', what: 'Single sign-on with your identity provider', builtIn: true },
  { name: 'OpenID Connect', category: 'Identity', icon: 'Fingerprint', what: 'Single sign-on with automatic user provisioning', builtIn: true },
  { name: 'Webhooks', category: 'Events', icon: 'Webhook', what: 'Outbound events with retries and dead-letter replay', builtIn: true },
  { name: 'Inbound webhooks', category: 'Events', icon: 'ArrowDownToLine', what: 'Let external systems create and update records', builtIn: true },
  { name: 'REST API', category: 'Platform', icon: 'Code2', what: 'Everything in the interface, available over the API', builtIn: true },
  { name: 'OAuth 2.0 apps', category: 'Platform', icon: 'ShieldCheck', what: 'Authorise third-party apps to act on a workspace', builtIn: true },
  { name: 'Embeddable forms', category: 'Capture', icon: 'ClipboardList', what: 'Drop a form onto any site and capture leads instantly', builtIn: true },
  { name: 'Website chat widget', category: 'Capture', icon: 'MessagesSquare', what: 'Live chat with session history on the contact record', builtIn: true },
  { name: 'Visitor tracking', category: 'Capture', icon: 'Eye', what: 'Page-view history attached to known contacts', builtIn: true },
];

export const CONNECTOR_CATEGORIES = [
  'Email delivery',
  'Mailbox sync',
  'Messaging',
  'Chat-ops',
  'Payments',
  'AI providers',
  'Calendar',
  'Identity',
  'Events',
  'Platform',
  'Capture',
] as const;

export const ENGINE_POINTS = [
  {
    title: 'Bring a URL and a key',
    body: 'Point the integration engine at an API, give it credentials, and it discovers the request patterns instead of making you write a mapping file.',
    icon: 'Plug',
  },
  {
    title: 'No connector, no problem',
    body: 'If a vendor has an HTTP API, you can call it from a workflow action. You are not waiting for us to build a logo tile.',
    icon: 'Wand2',
  },
  {
    title: 'Failures are visible',
    body: 'Every delivery attempt is logged with status and payload. Failures retry with exponential backoff and land in a dead-letter queue you can inspect and replay.',
    icon: 'Activity',
  },
  {
    title: 'Build your own module',
    body: 'The module SDK lets you ship a real extension — its own screens, its own data, its own permissions — on top of the platform.',
    icon: 'Blocks',
  },
] as const;

export const API_POINTS = [
  'Documented REST API covering every entity in the product',
  'Interactive API reference available inside your workspace',
  'API keys per workspace with scoped permissions and revocation',
  'OAuth 2.0 authorisation-code flow for third-party applications',
  'Tiered rate limits with clear headers, visible usage metering',
  'Outbound webhooks for every meaningful event, with signature verification',
  'Inbound webhooks so external systems can drive CRM changes',
  'Bulk import and full workspace export for your own warehouse',
] as const;
