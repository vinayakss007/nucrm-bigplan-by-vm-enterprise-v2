import type { ProviderDefinition } from '../types';

export const sendgridProvider: ProviderDefinition = {
  id: 'sendgrid',
  name: 'SendGrid',
  description: 'Send transactional emails, track opens/clicks, manage contacts',
  category: 'email',
  icon: 'Mail',
  docsUrl: 'https://docs.sendgrid.com/api-reference',
  configFields: [
    { key: 'api_key', label: 'API Key', type: 'string', required: true, placeholder: 'SG.xxxxx...' },
    { key: 'from_email', label: 'From Email', type: 'string', required: true, placeholder: 'noreply@yourdomain.com' },
    { key: 'from_name', label: 'From Name', type: 'string', placeholder: 'NuCRM' },
  ],
  capabilities: [
    { action: 'send_email', label: 'Send Email', description: 'Send a transactional email',
      inputFields: [
        { key: 'to', label: 'To', type: 'string', required: true },
        { key: 'subject', label: 'Subject', type: 'string', required: true },
        { key: 'body', label: 'Body (HTML)', type: 'string', required: true },
      ]},
    { action: 'add_contact', label: 'Add Contact', description: 'Add to contact list',
      inputFields: [
        { key: 'email', label: 'Email', type: 'string', required: true },
        { key: 'first_name', label: 'First Name', type: 'string' },
        { key: 'last_name', label: 'Last Name', type: 'string' },
      ]},
  ],
  defaultBaseUrl: 'https://api.sendgrid.com/v3',
  builtIn: true,
};
