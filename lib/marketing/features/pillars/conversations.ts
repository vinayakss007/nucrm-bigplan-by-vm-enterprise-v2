/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const conversationsPillar: Pillar = {
  slug: 'conversations',
  name: 'Conversations',
  short: 'Conversations',
  icon: 'MessageSquare',
  accent: 'from-emerald-400 to-teal-500',
  eyebrow: 'Conversations',
  headline: 'Email, WhatsApp, SMS, chat and calls — one timeline',
  sub: 'Every message a customer ever sent you, in one place, attached to the record it belongs to.',
  blurb: 'Omnichannel messaging with templates, tracking, warmup and a unified customer timeline.',
  highlights: [
    { title: 'One timeline per customer', desc: 'Email threads, WhatsApp messages, SMS, chat sessions and call notes land on the same record, in order.', icon: 'MessagesSquare' },
    { title: 'Templates with variables', desc: 'Reusable email, SMS and WhatsApp templates with merge fields, plus canned responses for support.', icon: 'Copy' },
    { title: 'Know what landed', desc: 'Open and click tracking on outbound email, delivery status on messaging, engagement rolled into scoring.', icon: 'Eye' },
    { title: 'Deliverability care', desc: 'Sending-domain warmup with gradual volume ramp so your cold outreach does not torch your domain.', icon: 'Flame' },
  ],
  capabilities: [
    {
      heading: 'Channels',
      items: [
        'Email: send, receive, thread, template, bulk-send and track',
        'WhatsApp Business: template messages, auto-replies, broadcasts and conversation history',
        'SMS with templates and delivery webhooks',
        'Live chat widget with session management and transcript history',
        'Call logging with notes, outcomes and recording links',
        'Telegram notifications for internal alerting',
      ],
    },
    {
      heading: 'Inbox & composer',
      items: [
        'AI drafting and tone control inside the composer',
        'Scheduled sending and follow-up reminders',
        'Attachments pulled from the document library',
        'Auto-logging of every message to the related contact, deal or ticket',
        'Bulk send to a saved segment with per-recipient personalisation',
      ],
    },
    {
      heading: 'Capture & notify',
      items: [
        'Embeddable forms with a visual builder, conditional logic and spam protection',
        'Public lead-capture pages that create records instantly',
        'Website visitor tracking with page-view history on the contact record',
        'In-app notifications with live unread counts and email digests',
      ],
    },
  ],
  outcomes: [
    'No more "check my inbox" archaeology',
    'Support and sales see the same history',
    'Outreach at volume without wrecking deliverability',
  ],
  related: ['automation', 'support', 'ai'],
};
