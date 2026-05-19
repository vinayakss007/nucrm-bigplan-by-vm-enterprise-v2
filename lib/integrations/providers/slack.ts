import type { ProviderDefinition } from '../types';

export const slackProvider: ProviderDefinition = {
  id: 'slack',
  name: 'Slack',
  description: 'Send messages, notifications, and alerts to channels',
  category: 'messaging',
  icon: 'MessageSquare',
  docsUrl: 'https://api.slack.com/methods',
  configFields: [
    { key: 'bot_token', label: 'Bot Token', type: 'string', required: true, placeholder: 'xoxb-...' },
    { key: 'default_channel', label: 'Default Channel', type: 'string', placeholder: '#general' },
  ],
  capabilities: [
    { action: 'send_message', label: 'Send Message', description: 'Post a message to a channel',
      inputFields: [
        { key: 'channel', label: 'Channel', type: 'string', placeholder: '#general' },
        { key: 'text', label: 'Message Text', type: 'string', required: true },
      ]},
  ],
  defaultBaseUrl: 'https://slack.com/api',
  builtIn: true,
};
