/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { LegalShell } from '@/components/marketing/legal-shell';

export const metadata: Metadata = {
  title: 'Refund & cancellation policy',
  description:
    'How NuCRM subscriptions are billed, how to cancel, and when you are owed a refund — including free trials, annual plans, service outages and billing errors.',
  alternates: { canonical: '/legal/refunds' },
};

const SECTIONS = [
  { id: 'billing', label: 'How billing works' },
  { id: 'trial', label: 'Free trials' },
  { id: 'cancel', label: 'Cancelling' },
  { id: 'refunds', label: 'When we refund' },
  { id: 'no-refunds', label: 'When we do not refund' },
  { id: 'sla', label: 'Service credits' },
  { id: 'disputes', label: 'Disputes and contact' },
];

export default function RefundsPage() {
  return (
    <LegalShell
      eyebrow="Refund policy"
      title="Refund & cancellation policy"
      sub="Plain terms for money: what you are billed, how to stop it, and exactly when a refund is owed. This policy forms part of the Terms of Service."
      updated="2026-10-05"
      sections={SECTIONS}
    >
      <p>
        This policy applies to subscriptions to {BRAND.product} purchased from {BRAND.maker}. Where it conflicts with a
        negotiated written agreement (for example an Enterprise contract), the signed agreement wins for that customer.
      </p>

      <h2 id="billing">How billing works</h2>
      <ul>
        <li>Plans are billed in advance — monthly on the monthly cycle, annually on the annual cycle.</li>
        <li>Prices shown on the <a href="/pricing">pricing page</a> at checkout are the prices you are charged for that term.</li>
        <li>Each renewal invoice is due on the anniversary of your subscription unless you cancel first.</li>
        <li>Changes in seat count or modules take effect according to the proration rules shown at the time of the change.</li>
      </ul>

      <h2 id="trial">Free trials</h2>
      <p>
        Where we offer a free trial, it converts to a paid subscription only if you add a payment method and let it run past
        the trial window. If your workspace is cancelled or removed before the trial ends, you are not charged. We will
        notify you before a trial converts whenever we have your email on file.
      </p>

      <h2 id="cancel">Cancelling</h2>
      <ul>
        <li>
          You can cancel a self-service subscription at any time from your workspace&apos;s billing settings — no phone call,
          no retention maze.
        </li>
        <li>Cancelling stops the next renewal. Your workspace stays available until the end of the term you already paid for.</li>
        <li>
          After the term ends, data remains available for export for the retention window described in the{' '}
          <a href="/legal/dpa">data processing terms</a>, then the workspace is deleted.
        </li>
        <li>You may reactivate a plan within the retention window without losing your data.</li>
      </ul>

      <h2 id="refunds">When we refund</h2>
      <ul>
        <li>
          <strong>First annual payment:</strong> if you cancel an annual subscription within 14 days of being charged for the
          first annual term, we refund that payment in full.
        </li>
        <li>
          <strong>Billing errors:</strong> duplicate charges, charges after a processed cancellation, or charges that do not
          match the price shown at checkout are corrected and refunded promptly once verified.
        </li>
        <li>
          <strong>Material failure to deliver:</strong> if a paid feature we advertised is unavailable for an extended period
          and the remedy in <a href="#sla">service credits</a> does not apply, we will refund a proportional amount for the
          affected period.
        </li>
        <li>
          <strong>Consumer cooling-off (where required by law):</strong> where your jurisdiction grants a statutory
          withdrawal period for online purchases, it applies regardless of anything in this policy.
        </li>
      </ul>

      <h2 id="no-refunds">When we do not refund</h2>
      <ul>
        <li>Monthly subscriptions cancelled mid-cycle — access simply continues until the period ends and no renewal is charged.</li>
        <li>Renewal payments on annual terms cancelled after the 14-day window described above.</li>
        <li>
          Changes of mind after you have used the service through the term, downgrades that were your own choice, or
          subscription fees during periods when the service was available and working.
        </li>
        <li>Third-party costs you incurred (integration marketplace charges, SMS volumes, extra email sending) once consumed.</li>
      </ul>

      <h2 id="sla">Service credits</h2>
      <p>
        Sustained unavailability is compensated with service credits rather than cash refunds. To be eligible, report the
        incident within 30 days and be current on payment; we assess it against our monitoring data and the uptime commitment
        in your plan. Scheduled maintenance announced in advance does not count toward an outage.
      </p>

      <h2 id="disputes">Disputes and contact</h2>
      <p>
        To request a refund, cancel, or report a billing problem, email <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>{' '}
        with your workspace name and the invoice in question. We answer billing requests within two business days. If you
        paid through a card network dispute process instead, we will cooperate with the issuer but expect a good-faith
        request first.
      </p>
    </LegalShell>
  );
}
