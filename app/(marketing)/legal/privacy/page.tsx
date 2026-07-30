import type { Metadata } from 'next';
import { BRAND } from '@/lib/marketing/site';
import { LegalShell } from '@/components/marketing/legal-shell';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How abetworks collects, uses, stores and deletes personal data in NuCRM and on this website.',
  alternates: { canonical: '/legal/privacy' },
};

const SECTIONS = [
  { id: 'roles', label: 'Who is responsible' },
  { id: 'collect', label: 'What we collect' },
  { id: 'use', label: 'How we use it' },
  { id: 'ai', label: 'AI features' },
  { id: 'share', label: 'Who we share with' },
  { id: 'retention', label: 'How long we keep it' },
  { id: 'rights', label: 'Your rights' },
  { id: 'security', label: 'Security' },
  { id: 'transfers', label: 'International transfers' },
  { id: 'children', label: 'Children' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact' },
];

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Privacy policy"
      title="Privacy policy"
      sub="What we collect, why, how long we keep it, and how to make us delete it. Written to be read, not to be survived."
      updated="2026-07-29"
      sections={SECTIONS}
    >
      <p>
        This policy covers the NuCRM application, the customer portal, our public website and any support conversation you
        have with us. NuCRM is a product of {BRAND.maker}.
      </p>

      <h2 id="roles">Who is responsible for what</h2>
      <p>There are two distinct relationships here, and the difference matters:</p>
      <ul>
        <li>
          <strong>Data we control.</strong> Your account details, billing information, support conversations and website
          analytics. We decide how these are used, so we are the controller.
        </li>
        <li>
          <strong>Data you control.</strong> The customer records, contacts, deals, tickets, documents and messages you put
          into your workspace. You decide what goes in and why. We process it on your instructions and nothing else — see
          our <a href="/legal/dpa">data processing terms</a>.
        </li>
      </ul>
      <p>
        In practice: we never mine your workspace, we never sell anything in it, and we do not use it to market to your
        customers.
      </p>

      <h2 id="collect">What we collect</h2>
      <h3>When you create an account</h3>
      <ul>
        <li>Name, work email, and the workspace name you choose</li>
        <li>A password, stored only as a one-way hash we cannot reverse</li>
        <li>Company name, role and team size, where you tell us</li>
      </ul>
      <h3>When you use the product</h3>
      <ul>
        <li>Authentication and session events, including IP address and browser user agent, for security</li>
        <li>Feature and volume usage counts, for plan limits and billing</li>
        <li>Diagnostic and error information when something goes wrong</li>
        <li>Whatever you choose to store in your workspace, which remains yours</li>
      </ul>
      <h3>When you pay us</h3>
      <ul>
        <li>Billing contact, address and tax identifiers</li>
        <li>
          Payment card details are handled by our payment processor and never stored on our systems — we keep only a token
          and the last four digits
        </li>
      </ul>
      <h3>When you visit the website</h3>
      <ul>
        <li>Page views and referrer, in aggregate, to understand which pages are useful</li>
        <li>Anything you type into a contact or enquiry form</li>
      </ul>

      <h2 id="use">How we use it</h2>
      <ul>
        <li>To provide the product you signed up for, and to keep your account secure</li>
        <li>To bill you accurately and enforce plan limits</li>
        <li>To answer your support requests</li>
        <li>To detect abuse, fraud and attacks against the service</li>
        <li>To decide what to build next, using aggregate usage patterns rather than reading individual records</li>
        <li>To send service notices you cannot opt out of, such as security or billing changes</li>
      </ul>
      <p>
        Marketing email is opt-in and separately unsubscribable. We do not add you to a nurture sequence because you filled
        in a contact form.
      </p>

      <h2 id="ai">AI features</h2>
      <p>
        Assistant features send only the specific context needed for the request you triggered — the record you are
        drafting against, not your database.
      </p>
      <ul>
        <li>Your workspace content is not used to train any model, ours or a provider&apos;s</li>
        <li>You can supply your own AI provider key, in which case requests go to your account under your terms</li>
        <li>Every AI action is logged in your workspace with the user, feature and credit cost</li>
        <li>Assistant features can be switched off entirely at workspace level</li>
      </ul>

      <h2 id="share">Who we share it with</h2>
      <p>
        We do not sell personal data. We share it only with service providers who help us run the product, each bound by a
        contract that limits them to that purpose:
      </p>
      <ul>
        <li>Infrastructure and hosting providers</li>
        <li>Email, SMS and messaging delivery providers, for messages you send</li>
        <li>Payment processing and tax calculation providers</li>
        <li>Error monitoring and product analytics providers</li>
        <li>AI providers, where assistant features are enabled</li>
      </ul>
      <p>
        A current list of sub-processors is available on request. We will also disclose data where we are legally compelled
        to, and where possible we will tell you first.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <ul>
        <li>
          <strong>Workspace data:</strong> for as long as your account is active. After cancellation it stays available for
          export during a defined window set out in your agreement, then it is deleted.
        </li>
        <li>
          <strong>Deleted records:</strong> soft-deleted first, recoverable from trash, then permanently removed according
          to the retention policy your workspace configures.
        </li>
        <li>
          <strong>Backups:</strong> held on a rolling schedule and overwritten in turn, so deletion propagates through
          backups within that cycle.
        </li>
        <li>
          <strong>Billing records:</strong> retained as long as tax and accounting law requires.
        </li>
        <li>
          <strong>Security and audit logs:</strong> retained for a defined period, then rotated.
        </li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>Depending on where you live, you can ask us to:</p>
      <ul>
        <li>Tell you what personal data we hold about you, and give you a copy</li>
        <li>Correct anything inaccurate</li>
        <li>Delete your data, subject to legal retention obligations</li>
        <li>Export your data in a structured, machine-readable format</li>
        <li>Restrict or object to certain processing</li>
        <li>Withdraw consent where processing relies on it</li>
      </ul>
      <p>
        If your data sits inside someone else&apos;s workspace — because you are their customer, not ours — direct the
        request to them. They have product tooling to handle it, and we will help them if they ask.
      </p>
      <p>
        Email <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> to make a request. We respond within the period the
        applicable law requires, and within 30 days in any case.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Encryption in transit and at rest, field-level encryption for sensitive attributes, workspace isolation enforced
        beneath the application, role-based access with record and field-level rules, two-factor authentication, immutable
        audit logging, and tested backup and restore. The{' '}
        <a href="/security">security overview</a> describes all of this in detail.
      </p>
      <p>
        If we suffer a breach affecting your data, we will notify you and, where required, the relevant supervisory
        authority, without undue delay.
      </p>

      <h2 id="transfers">International transfers</h2>
      <p>
        Our providers may process data outside your country. Where that happens we rely on appropriate safeguards, such as
        standard contractual clauses. Enterprise agreements can specify the region in which your workspace data is stored.
      </p>

      <h2 id="children">Children</h2>
      <p>
        NuCRM is a business product and is not directed at children. We do not knowingly collect personal data from anyone
        under 16. If you believe we have, tell us and we will delete it.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We will update this page when our practices change, and revise the date at the top. For material changes affecting
        how we use personal data, we will notify account owners by email before the change takes effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Privacy questions, data requests and complaints: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>. If you are
        not satisfied with our response, you have the right to complain to your local data protection authority.
      </p>
    </LegalShell>
  );
}
