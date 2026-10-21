/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Pillar } from "../types";

export const quoteToCashPillar: Pillar = {
  slug: 'quote-to-cash',
  name: 'Quote to cash',
  short: 'Billing',
  icon: 'Receipt',
  accent: 'from-cyan-400 to-blue-500',
  eyebrow: 'Quote to cash',
  headline: 'From "send me a quote" to money in the bank',
  sub: 'Quotes, offers, e-signature, orders, contracts, subscriptions and invoices — attached to the deal that created them.',
  blurb: 'Quotes, e-signature, orders, contracts, subscriptions, invoices, tax and multi-currency.',
  highlights: [
    { title: 'Quote in a click', desc: 'Build line items from your catalogue and price books, apply tax, produce a branded print-ready document and send it.', icon: 'FileSignature' },
    { title: 'Shareable offers', desc: 'Send a public offer link the customer can accept or decline without creating an account. You see the moment they open it.', icon: 'Link2' },
    { title: 'Signed and stored', desc: 'Built-in e-signature with signing events recorded, and the executed document filed against the record.', icon: 'PenTool' },
    { title: 'Recurring revenue', desc: 'Subscriptions with trials, upgrades and downgrades, with renewal reminders on a schedule.', icon: 'RefreshCw' },
  ],
  capabilities: [
    {
      heading: 'Sell',
      items: [
        'Product catalogue with SKUs, price books and per-region pricing',
        'Quotes with line items, discounts, approval workflow and print-ready output',
        'Public offer links with accept/decline tracking',
        'E-signature requests with a full signing event log',
        'Approval requests for anything above a threshold you define',
      ],
    },
    {
      heading: 'Fulfil & bill',
      items: [
        'Orders with line items, shipping and status tracking',
        'Contracts with renewal tracking and automatic reminders',
        'Subscriptions with trial management and plan changes',
        'Invoices with line items, payment tracking and partial payments',
        'Automatic tax calculation with multi-jurisdiction rates and exemptions',
        'Multi-currency with live exchange rates and reporting in your base currency',
      ],
    },
    {
      heading: 'Documents',
      items: [
        'Document library with folders and per-record attachments',
        'Branded, print-ready documents for quotes and invoices (print or save to PDF from the browser)',
        'Customer portal access to invoices and quotes',
        'Retention policies applied to financial documents',
      ],
    },
  ],
  outcomes: [
    'Quotes go out the same day they are asked for',
    'Renewals stop expiring unnoticed',
    'Finance and sales argue about numbers less',
  ],
  related: ['sales-pipeline', 'support', 'analytics'],
};
