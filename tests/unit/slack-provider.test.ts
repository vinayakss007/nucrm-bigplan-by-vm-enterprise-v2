import { describe, it, expect } from 'vitest';
import { slackProvider } from '@/lib/integrations/providers/slack';

describe('slackProvider', () => {
  it('has the correct definition properties', () => {
    expect(slackProvider.id).toBe('slack');
    expect(slackProvider.name).toBe('Slack');
    expect(slackProvider.description).toBe('Send messages, notifications, and alerts to channels');
    expect(slackProvider.category).toBe('messaging');
    expect(slackProvider.icon).toBe('MessageSquare');
    expect(slackProvider.docsUrl).toBe('https://api.slack.com/methods');
    expect(slackProvider.defaultBaseUrl).toBe('https://slack.com/api');
    expect(slackProvider.builtIn).toBe(true);
  });

  it('has the correct configFields', () => {
    expect(slackProvider.configFields).toHaveLength(2);

    expect(slackProvider.configFields[0]).toEqual({
      key: 'bot_token',
      label: 'Bot Token',
      type: 'string',
      required: true,
      placeholder: 'xoxb-...',
    });

    expect(slackProvider.configFields[1]).toEqual({
      key: 'default_channel',
      label: 'Default Channel',
      type: 'string',
      placeholder: '#general',
    });
  });

  it('has the correct capabilities', () => {
    expect(slackProvider.capabilities).toHaveLength(1);

    const sendMsgCap = slackProvider.capabilities[0];
    expect(sendMsgCap.action).toBe('send_message');
    expect(sendMsgCap.label).toBe('Send Message');
    expect(sendMsgCap.description).toBe('Post a message to a channel');

    expect(sendMsgCap.inputFields).toHaveLength(2);
    expect(sendMsgCap.inputFields![0]).toEqual({
      key: 'channel',
      label: 'Channel',
      type: 'string',
      placeholder: '#general',
    });

    expect(sendMsgCap.inputFields![1]).toEqual({
      key: 'text',
      label: 'Message Text',
      type: 'string',
      required: true,
    });
  });
});
