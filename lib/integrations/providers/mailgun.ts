import type { ProviderDefinition } from '../types';

export const mailgunProvider: ProviderDefinition = {
  id: 'mailgun',
  name: 'Mailgun',
  description: 'Send, receive, and track emails via Mailgun API',
  category: 'email',
  icon: 'Mail',
  docsUrl: 'https://documentation.mailgun.com/api_reference.html',
  configFields: [
    { key: 'api_key', label: 'API Key', type: 'string', required: true, placeholder: 'key-xxxxx' },
    { key: 'domain', label: 'Domain', type: 'string', required: true, placeholder: 'mg.yourdomain.com' },
    { key: 'from_email', label: 'From Email', type: 'string', required: true },
    { key: 'from_name', label: 'From Name', type: 'string', placeholder: 'NuCRM' },
    { key: 'base_url', label: 'API Region', type: 'select', options: [
      { label: 'US (api.mailgun.net)', value: 'https://api.mailgun.net/v3' },
      { label: 'EU (api.eu.mailgun.net)', value: 'https://api.eu.mailgun.net/v3' },
    ]},
  ],
  capabilities: [
    { action: 'send_email', label: 'Send Email', description: 'Send an email',
      inputFields: [
        { key: 'to', label: 'To', type: 'string', required: true },
        { key: 'subject', label: 'Subject', type: 'string', required: true },
        { key: 'body', label: 'Body (HTML)', type: 'string', required: true },
      ]},
  ],
  defaultBaseUrl: 'https://api.mailgun.net/v3',
  builtIn: true,
};
